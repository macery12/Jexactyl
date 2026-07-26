<?php

namespace Everest\Tests\Integration\Api\Remote;

use Aws\Result;
use Everest\Models\Node;
use Aws\CommandInterface;
use Everest\Models\Backup;
use Aws\S3\S3ClientInterface;
use GuzzleHttp\Psr7\Request as PsrRequest;
use Illuminate\Support\Facades\RateLimiter;
use Everest\Extensions\Backups\BackupManager;
use PHPUnit\Framework\Attributes\DataProvider;
use Everest\Extensions\Filesystem\S3Filesystem;
use Everest\Tests\Integration\IntegrationTestCase;
use Everest\Extensions\Backups\S3MultipartUploadLimits;
use Everest\Http\Requests\Api\Remote\ReportBackupCompleteRequest;

class BackupRemoteUploadSecurityTest extends IntegrationTestCase
{
    private Node $node;

    private Backup $backup;

    public function setUp(): void
    {
        parent::setUp();

        $server = $this->createServerModel();
        $this->node = $server->node;
        $this->backup = Backup::factory()->create([
            'server_id' => $server->id,
            'disk' => Backup::ADAPTER_AWS_S3,
            'is_successful' => false,
            'completed_at' => null,
            'ignored_files' => [],
        ]);

        $this->withHeader(
            'Authorization',
            'Bearer ' . $this->node->daemon_token_id . '.' . decrypt($this->node->daemon_token)
        );
    }

    #[DataProvider('invalidSizeProvider')]
    public function testSizeMustBeACanonicalPositiveInteger(string $query): void
    {
        $this->instance(BackupManager::class, $manager = \Mockery::mock(BackupManager::class));
        $manager->shouldNotReceive('adapter');

        $this->getJson("/api/remote/backups/{$this->backup->uuid}{$query}")
            ->assertBadRequest();
    }

    public static function invalidSizeProvider(): array
    {
        return [
            'missing' => [''],
            'zero' => ['?size=0'],
            'negative' => ['?size=-1'],
            'leading zero' => ['?size=01'],
            'decimal' => ['?size=1.0'],
            'exponent' => ['?size=1e3'],
            'array' => ['?size[]=1'],
            'integer overflow' => ['?size=999999999999999999999999999999999999'],
        ];
    }

    public function testObjectAndSigningWorkLimitsAreCheckedBeforeAdapterAccess(): void
    {
        $this->instance(BackupManager::class, $manager = \Mockery::mock(BackupManager::class));
        $manager->shouldNotReceive('adapter');

        config()->set('backups.max_multipart_size', 100);
        $this->getJson("/api/remote/backups/{$this->backup->uuid}?size=101")
            ->assertBadRequest();

        config()->set('backups.max_multipart_size', S3MultipartUploadLimits::MAX_OBJECT_SIZE);
        config()->set('backups.max_part_size', S3MultipartUploadLimits::MIN_PART_SIZE);
        config()->set('backups.max_presigned_parts', 2);
        $size = (2 * S3MultipartUploadLimits::MIN_PART_SIZE) + 1;

        $this->getJson("/api/remote/backups/{$this->backup->uuid}?size={$size}")
            ->assertBadRequest();
    }

    #[DataProvider('partCountProvider')]
    public function testBoundedUploadGeneratesTheExactIntegerPartCount(int $size, int $expectedParts): void
    {
        $client = \Mockery::mock(S3ClientInterface::class);
        $create = \Mockery::mock(CommandInterface::class);
        $uploadPart = \Mockery::mock(CommandInterface::class);
        $partNumbers = [];

        $client->expects('getCommand')
            ->once()
            ->with('CreateMultipartUpload', \Mockery::type('array'))
            ->andReturn($create);
        $client->expects('execute')->once()->with($create)->andReturn(new Result(['UploadId' => 'upload-123']));
        $client->expects('getCommand')
            ->times($expectedParts)
            ->with('UploadPart', \Mockery::on(function (array $params) use (&$partNumbers) {
                $partNumbers[] = $params['PartNumber'];

                return true;
            }))
            ->andReturn($uploadPart);
        $client->expects('createPresignedRequest')
            ->times($expectedParts)
            ->with($uploadPart, \Mockery::type(\DateTimeInterface::class))
            ->andReturn(new PsrRequest('PUT', 'https://storage.example.test/upload-part'));

        $filesystem = new S3Filesystem($client, 'backups');
        $this->instance(BackupManager::class, $manager = \Mockery::mock(BackupManager::class));
        $manager->expects('adapter')->once()->andReturn($filesystem);
        config()->set('backups.max_part_size', S3MultipartUploadLimits::MIN_PART_SIZE);

        $this->getJson("/api/remote/backups/{$this->backup->uuid}?size={$size}")
            ->assertOk()
            ->assertJsonCount($expectedParts, 'parts')
            ->assertJsonPath('part_size', S3MultipartUploadLimits::MIN_PART_SIZE);

        $this->assertSame(range(1, $expectedParts), $partNumbers);
        $this->assertSame('upload-123', $this->backup->fresh()->upload_id);
    }

    public static function partCountProvider(): array
    {
        return [
            'exactly one part' => [S3MultipartUploadLimits::MIN_PART_SIZE, 1],
            'one byte over one part' => [S3MultipartUploadLimits::MIN_PART_SIZE + 1, 2],
        ];
    }

    public function testSigningFailureAbortsUploadAndClearsPersistedIdentifier(): void
    {
        $client = \Mockery::mock(S3ClientInterface::class);
        $create = \Mockery::mock(CommandInterface::class);
        $uploadPart = \Mockery::mock(CommandInterface::class);
        $abort = \Mockery::mock(CommandInterface::class);

        $client->expects('getCommand')
            ->once()
            ->with('CreateMultipartUpload', \Mockery::type('array'))
            ->andReturn($create);
        $client->expects('execute')->once()->with($create)->andReturn(new Result(['UploadId' => 'upload-123']));
        $client->expects('getCommand')
            ->once()
            ->with('UploadPart', \Mockery::on(fn (array $params) => $params['PartNumber'] === 1))
            ->andReturn($uploadPart);
        $client->expects('createPresignedRequest')
            ->once()
            ->with($uploadPart, \Mockery::type(\DateTimeInterface::class))
            ->andThrow(new \RuntimeException('Signing failed.'));
        $client->expects('getCommand')
            ->once()
            ->with('AbortMultipartUpload', \Mockery::on(fn (array $params) => $params['UploadId'] === 'upload-123'))
            ->andReturn($abort);
        $client->expects('execute')->once()->with($abort)->andReturn(new Result());

        $filesystem = new S3Filesystem($client, 'backups');
        $this->instance(BackupManager::class, $manager = \Mockery::mock(BackupManager::class));
        $manager->expects('adapter')->once()->andReturn($filesystem);

        config()->set('backups.max_part_size', S3MultipartUploadLimits::MIN_PART_SIZE);

        $this->getJson("/api/remote/backups/{$this->backup->uuid}?size=1")
            ->assertInternalServerError();

        $this->assertNull($this->backup->fresh()->upload_id);
    }

    public function testSigningWorkIsRateLimitedPerAuthenticatedNode(): void
    {
        $this->instance(BackupManager::class, $manager = \Mockery::mock(BackupManager::class));
        $manager->shouldNotReceive('adapter');

        config()->set('backups.remote_upload_rate_limit', 1);
        $key = 'remote-backup-upload:' . $this->node->id . ':requests';
        RateLimiter::hit($key, 60);

        $this->getJson("/api/remote/backups/{$this->backup->uuid}?size=1")
            ->assertTooManyRequests();
    }

    public function testPresignedPartWorkHasASeparatePerNodeBudget(): void
    {
        $this->instance(BackupManager::class, $manager = \Mockery::mock(BackupManager::class));
        $manager->shouldNotReceive('adapter');

        config()->set('backups.remote_upload_part_limit', 1);
        $key = 'remote-backup-upload:' . $this->node->id . ':parts';
        RateLimiter::hit($key, 60);

        $this->getJson("/api/remote/backups/{$this->backup->uuid}?size=1")
            ->assertTooManyRequests();
    }

    public function testCompletionPartListHasABoundedValidationBudget(): void
    {
        $this->instance(BackupManager::class, $manager = \Mockery::mock(BackupManager::class));
        $manager->shouldNotReceive('adapter');
        config()->set('backups.max_completion_parts', 2);

        $payload = [
            'successful' => true,
            'checksum' => 'checksum',
            'checksum_type' => 'sha256',
            'size' => 3,
            'parts' => [
                ['etag' => 'one', 'part_number' => 1],
                ['etag' => 'two', 'part_number' => 2],
                ['etag' => 'three', 'part_number' => 3],
            ],
        ];

        $request = ReportBackupCompleteRequest::create('/', 'POST', $payload);
        $rules = $request->rules();
        $this->assertArrayNotHasKey('parts.*.etag', $rules);
        $this->assertArrayNotHasKey('parts.*.part_number', $rules);

        $this->postJson("/api/remote/backups/{$this->backup->uuid}", $payload)
            ->assertUnprocessable();

        $this->assertNull($this->backup->fresh()->completed_at);
    }
}

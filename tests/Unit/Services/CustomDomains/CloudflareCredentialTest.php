<?php

namespace Everest\Tests\Unit\Services\CustomDomains;

use Everest\Models\Setting;
use Everest\Tests\TestCase;
use Everest\Facades\Activity;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Everest\Services\Security\LogSanitizer;
use Everest\Services\CustomDomains\CloudflareDnsService;
use Everest\Services\CustomDomains\CloudflareCredentialService;
use Everest\Http\Controllers\Api\Application\CustomDomains\SettingsController;
use Everest\Http\Requests\Api\Application\CustomDomains\GetCustomDomainSettingsRequest;
use Everest\Http\Requests\Api\Application\CustomDomains\UpdateCustomDomainSettingsRequest;

class CloudflareCredentialTest extends TestCase
{
    private const TOKEN = 'test-cloudflare-credential-123456789';

    public function setUp(): void
    {
        parent::setUp();
        Schema::dropIfExists('settings');
        Schema::create('settings', function (Blueprint $table) {
            $table->increments('id');
            $table->string('key')->unique();
            $table->text('value');
        });
        Setting::forget(CloudflareCredentialService::KEY);
        Setting::forget(CloudflareCredentialService::LEGACY_KEY);
        Http::preventStrayRequests();
        Activity::shouldReceive('event->description->log')->andReturnNull();
    }

    public function testWriteOnlySettingsReplacementAndClear(): void
    {
        $credential = app(CloudflareCredentialService::class);
        $controller = app(SettingsController::class);
        $this->assertFalse($credential->configured());
        $controller->update(UpdateCustomDomainSettingsRequest::create('/', 'PUT', ['cloudflare_token' => self::TOKEN]), $credential);
        $stored = DB::table('settings')->where('key', CloudflareCredentialService::KEY)->value('value');
        $this->assertSame(self::TOKEN, Crypt::decryptString($stored));
        $this->assertStringNotContainsString(self::TOKEN, $stored);
        $this->assertSame(self::TOKEN, $credential->token());
        $response = $controller->index(new GetCustomDomainSettingsRequest(), $credential);
        $this->assertTrue($response->getData(true)['data']['cloudflare_token_configured']);
        $this->assertArrayNotHasKey('cloudflare_token', $response->getData(true)['data']);
        $this->assertStringNotContainsString(self::TOKEN, $response->getContent());

        foreach ([[], ['cloudflare_token' => ''], ['cloudflare_token' => null]] as $input) {
            $controller->update(UpdateCustomDomainSettingsRequest::create('/', 'PUT', $input), $credential);
            $this->assertSame(self::TOKEN, $credential->token());
        }
        $controller->update(UpdateCustomDomainSettingsRequest::create('/', 'PUT', ['cloudflare_token' => self::TOKEN . '-rotated']), $credential);
        $this->assertSame(self::TOKEN . '-rotated', $credential->token());
        $controller->clearToken(new UpdateCustomDomainSettingsRequest(), $credential);
        $this->assertFalse($credential->configured());
        $this->assertSame('', $credential->token());
    }

    public function testLegacyMigrationEncryptsAndDoesNotRestorePlaintextOnRollback(): void
    {
        Setting::set(CloudflareCredentialService::LEGACY_KEY, self::TOKEN);
        $migration = require base_path('database/migrations/2026_09_07_000000_encrypt_custom_domains_cloudflare_token.php');
        $migration->up();
        $stored = DB::table('settings')->where('key', CloudflareCredentialService::KEY)->value('value');
        $this->assertSame(self::TOKEN, Crypt::decryptString($stored));
        $this->assertFalse(DB::table('settings')->where('key', CloudflareCredentialService::LEGACY_KEY)->exists());
        $migration->up();
        $migration->down();
        $this->assertSame($stored, DB::table('settings')->where('key', CloudflareCredentialService::KEY)->value('value'));
    }

    public function testMigrationWithoutAppKeyPreservesLegacyCredential(): void
    {
        Setting::set(CloudflareCredentialService::LEGACY_KEY, self::TOKEN);
        config()->set('app.key', null);
        $migration = require base_path('database/migrations/2026_09_07_000000_encrypt_custom_domains_cloudflare_token.php');
        try {
            $migration->up();
            $this->fail('Migration must fail without an encryption key.');
        } catch (\Illuminate\Encryption\MissingAppKeyException) {
            $this->assertSame(self::TOKEN, DB::table('settings')->where('key', CloudflareCredentialService::LEGACY_KEY)->value('value'));
            $this->assertFalse(DB::table('settings')->where('key', CloudflareCredentialService::KEY)->exists());
        }
    }

    public function testMissingAppKeyCannotReturnCiphertextToCloudflare(): void
    {
        app(CloudflareCredentialService::class)->replace(self::TOKEN);
        config()->set('app.key', null);
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('could not be decrypted');
        app(CloudflareCredentialService::class)->token();
    }

    public function testCiphertextCannotBeUsedAsAPlaintextFallback(): void
    {
        Setting::set(CloudflareCredentialService::KEY, 'corrupted-ciphertext');
        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('could not be decrypted');
        app(CloudflareCredentialService::class)->token();
    }

    public function testOutboundClientDecryptsCredentialAndNeverEchoesProviderBody(): void
    {
        app(CloudflareCredentialService::class)->replace(self::TOKEN);
        config()->set('modules.custom_domains.cloudflare.retries', 1);
        Http::fake(['*' => Http::sequence()
            ->push(['success' => true, 'result' => [['id' => 'zone']]])
            ->push(['message' => self::TOKEN], 403)]);
        $this->assertSame(['id' => 'zone'], app(CloudflareDnsService::class)->getZoneByName('example.com'));
        Http::assertSent(fn ($request) => $request->hasHeader('Authorization', 'Bearer ' . self::TOKEN));

        try {
            app(CloudflareDnsService::class)->getZoneByName('example.com');
            $this->fail('Expected provider failure.');
        } catch (\Exception $exception) {
            $this->assertSame('Cloudflare zone lookup failed. HTTP 403.', $exception->getMessage());
            $this->assertNull($exception->getPrevious());
            $this->assertStringNotContainsString(self::TOKEN, json_encode(LogSanitizer::exceptionContext($exception)));
        }
        $this->assertSame(['cloudflare_token' => '[REDACTED]'], LogSanitizer::redactSensitivePayload(['cloudflare_token' => self::TOKEN]));
    }
}

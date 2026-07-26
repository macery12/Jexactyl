<?php

namespace Everest\Tests\Integration\Services\Quotas;

use Everest\Models\User;
use Everest\Models\Backup;
use Everest\Models\Subuser;
use Everest\Exceptions\DisplayException;
use Everest\Tests\Integration\IntegrationTestCase;
use Everest\Services\Backups\InitiateBackupService;
use Everest\Services\Subusers\SubuserCreationService;
use Everest\Exceptions\Service\Backup\TooManyBackupsException;

class ServerQuotaSerializationTest extends IntegrationTestCase
{
    public function testBackupQuotaUsesFreshLockedServerStateBeforeDaemonDispatch(): void
    {
        config()->set('backups.throttles.period', 0);
        $server = $this->createServerModel(['backup_limit' => 2]);
        $staleServer = $server->fresh();
        Backup::factory()->create(['server_id' => $server->id]);
        $server->newQuery()->whereKey($server->id)->update(['backup_limit' => 1]);

        $this->expectException(TooManyBackupsException::class);
        $this->app->make(InitiateBackupService::class)->handle($staleServer);
    }

    public function testSubuserQuotaUsesFreshLockedServerState(): void
    {
        $server = $this->createServerModel(['subuser_limit' => 2]);
        $staleServer = $server->fresh();
        $existing = User::factory()->create();
        $candidate = User::factory()->create();
        Subuser::factory()->create([
            'server_id' => $server->id,
            'user_id' => $existing->id,
        ]);
        $server->newQuery()->whereKey($server->id)->update(['subuser_limit' => 1]);

        $this->expectException(DisplayException::class);
        $this->expectExceptionMessage('You cannot add any more subusers');
        $this->app->make(SubuserCreationService::class)->handle(
            $staleServer,
            $candidate->email,
            []
        );
    }
}

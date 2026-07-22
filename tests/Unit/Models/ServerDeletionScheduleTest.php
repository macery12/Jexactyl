<?php

namespace Everest\Tests\Unit\Models;

use Carbon\Carbon;
use Everest\Models\Server;
use Everest\Tests\TestCase;

class ServerDeletionScheduleTest extends TestCase
{
    public function testIsNotScheduledWhenNoTimestamp(): void
    {
        $server = new Server();

        $this->assertFalse($server->isDeletionScheduled());
    }

    public function testIsScheduledWhenSetWithoutCancellation(): void
    {
        $server = new Server();
        $server->deletion_scheduled_at = Carbon::now();

        $this->assertTrue($server->isDeletionScheduled());
    }

    public function testIsNotScheduledWhenCanceledAfterSchedule(): void
    {
        $server = new Server();
        $server->deletion_scheduled_at = Carbon::now()->subDay();
        $server->deletion_canceled_at = Carbon::now();

        $this->assertFalse($server->isDeletionScheduled());
    }

    public function testIsScheduledWhenCancellationIsBeforeSchedule(): void
    {
        $server = new Server();
        $server->deletion_canceled_at = Carbon::now()->subDay();
        $server->deletion_scheduled_at = Carbon::now();

        $this->assertTrue($server->isDeletionScheduled());
    }
}

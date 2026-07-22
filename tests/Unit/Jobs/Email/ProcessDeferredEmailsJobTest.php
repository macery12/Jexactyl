<?php

namespace Everest\Tests\Unit\Jobs\Email;

use Everest\Tests\TestCase;
use Illuminate\Support\Str;
use Everest\Models\EmailQuota;
use Everest\Models\DeferredEmail;
use Everest\Models\EmailDelivery;
use Illuminate\Support\Facades\Bus;
use Illuminate\Support\Facades\Log;
use Everest\Jobs\Email\SendEmailJob;
use Illuminate\Support\Facades\Schema;
use Illuminate\Database\Schema\Blueprint;
use Everest\Jobs\Email\ProcessDeferredEmailsJob;
use Everest\Services\Email\EmailDeliveryTracker;

class ProcessDeferredEmailsJobTest extends TestCase
{
    public function setUp(): void
    {
        parent::setUp();
        $this->setUpEmailTables();
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('deferred_emails');
        Schema::dropIfExists('email_quotas');
        Schema::dropIfExists('email_delivery_attempts');
        Schema::dropIfExists('email_deliveries');

        parent::tearDown();
    }

    public function testDispatchingDeferredEmailDoesNotReserveQuotaAndRemovesDeferredRecord(): void
    {
        Bus::fake();
        Log::spy();

        $quota = EmailQuota::create([
            'user_id' => 1,
            'plan' => 'free',
            'monthly_limit' => 3000,
            'daily_limit' => 100,
            'monthly_sent' => 27,
            'daily_sent' => 5,
            'month_reset_at' => now()->startOfMonth(),
            'day_reset_at' => now()->startOfDay(),
        ]);

        $correlationId = (string) Str::uuid();

        $delivery = EmailDelivery::create([
            'correlation_id' => $correlationId,
            'template_key' => 'auth.password_reset',
            'recipient' => 'deferred@example.com',
            'user_id' => null,
            'subject' => 'Reset your password',
            'provider' => 'resend',
            'status' => EmailDelivery::STATUS_DEFERRED,
            'attempts' => 0,
            'last_error' => 'Rate limit exceeded: daily_limit',
        ]);

        $deferred = DeferredEmail::create([
            'user_id' => 1,
            'template_key' => 'auth.password_reset',
            'recipient' => 'deferred@example.com',
            'data' => ['token' => 'abc123'],
            'correlation_id' => $correlationId,
            'reason' => 'daily_limit',
            'scheduled_at' => now()->subMinute(),
            'attempts' => 2,
        ]);

        (new ProcessDeferredEmailsJob())->handle(app(EmailDeliveryTracker::class));

        Bus::assertDispatched(SendEmailJob::class, function (SendEmailJob $job) use ($correlationId) {
            return $job->templateKey === 'auth.password_reset'
                && $job->recipient === 'deferred@example.com'
                && $job->userId === 1
                && $job->correlationId === $correlationId;
        });

        $this->assertDatabaseMissing('deferred_emails', ['id' => $deferred->id]);

        $quota->refresh();
        $this->assertSame(27, $quota->monthly_sent);
        $this->assertSame(5, $quota->daily_sent);

        $delivery->refresh();
        $this->assertSame(EmailDelivery::STATUS_QUEUED, $delivery->status);
        $this->assertNull($delivery->last_error);

        Log::shouldHaveReceived('info')
            ->with('ProcessDeferredEmailsJob: Dispatching deferred email', \Mockery::on(function (array $context) use ($deferred) {
                return $context['deferred_id'] === $deferred->id
                    && $context['template_key'] === 'auth.password_reset'
                    && $context['user_id'] === 1;
            }));
    }

    public function testDeferredProcessorNoLongerStopsAtThreeAttempts(): void
    {
        Bus::fake();

        $deferred = DeferredEmail::create([
            'user_id' => 1,
            'template_key' => 'auth.password_reset',
            'recipient' => 'retry@example.com',
            'data' => ['token' => 'xyz987'],
            'correlation_id' => (string) Str::uuid(),
            'reason' => 'daily_limit',
            'scheduled_at' => now()->subMinute(),
            'attempts' => 3,
        ]);

        (new ProcessDeferredEmailsJob())->handle(app(EmailDeliveryTracker::class));

        Bus::assertDispatched(SendEmailJob::class, function (SendEmailJob $job) use ($deferred) {
            return $job->correlationId === $deferred->correlation_id;
        });

        $this->assertDatabaseMissing('deferred_emails', ['id' => $deferred->id]);
    }

    public function testCheckingEmptyDeferredQueueDoesNotWriteRoutineInfoLogs(): void
    {
        Bus::fake();
        Log::spy();

        (new ProcessDeferredEmailsJob())->handle(app(EmailDeliveryTracker::class));

        Bus::assertNothingDispatched();
        Log::shouldNotHaveReceived('info');
    }

    private function setUpEmailTables(): void
    {
        Schema::dropIfExists('deferred_emails');
        Schema::dropIfExists('email_quotas');
        Schema::dropIfExists('email_delivery_attempts');
        Schema::dropIfExists('email_deliveries');

        Schema::create('email_deliveries', function (Blueprint $table) {
            $table->id();
            $table->uuid('correlation_id')->nullable();
            $table->string('template_key')->nullable();
            $table->string('recipient');
            $table->unsignedInteger('user_id')->nullable();
            $table->string('subject');
            $table->string('status')->default('queued');
            $table->string('provider')->nullable()->default('resend');
            $table->unsignedInteger('attempts')->default(0);
            $table->timestamp('last_attempt_at')->nullable();
            $table->timestamp('sent_at')->nullable();
            $table->string('last_message_id')->nullable();
            $table->unsignedInteger('last_status_code')->nullable();
            $table->text('last_error')->nullable();
            $table->json('tags')->nullable();
            $table->timestamps();
        });

        Schema::create('email_delivery_attempts', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('delivery_id');
            $table->unsignedInteger('attempt_number');
            $table->string('status');
            $table->boolean('success')->default(false);
            $table->string('provider_message_id')->nullable();
            $table->unsignedInteger('status_code')->nullable();
            $table->text('error_message')->nullable();
            $table->text('error')->nullable();
            $table->json('request_payload')->nullable();
            $table->text('response_payload')->nullable();
            $table->string('exception_class')->nullable();
            $table->longText('stacktrace')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->unsignedInteger('duration_ms')->nullable();
            $table->timestamp('created_at')->nullable();
        });

        Schema::create('email_quotas', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id')->unique();
            $table->string('plan')->default('free');
            $table->integer('monthly_limit')->default(3000);
            $table->integer('daily_limit')->nullable()->default(100);
            $table->integer('monthly_sent')->default(0);
            $table->integer('daily_sent')->default(0);
            $table->integer('monthly_overage')->default(0);
            $table->date('month_reset_at');
            $table->date('day_reset_at');
            $table->timestamps();
        });

        Schema::create('deferred_emails', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('user_id');
            $table->string('template_key');
            $table->string('recipient');
            $table->json('data');
            $table->string('correlation_id')->nullable();
            $table->string('reason');
            $table->timestamp('scheduled_at');
            $table->timestamp('sent_at')->nullable();
            $table->integer('attempts')->default(0);
            $table->timestamps();
        });
    }
}

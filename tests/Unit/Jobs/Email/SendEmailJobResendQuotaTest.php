<?php

namespace Everest\Tests\Unit\Jobs\Email;

use Everest\Tests\TestCase;
use Everest\Models\ResendQuota;
use Everest\Models\DeferredEmail;
use Everest\Jobs\Email\SendEmailJob;
use Illuminate\Support\Facades\Schema;
use Everest\Services\Email\EmailManager;
use Illuminate\Database\Schema\Blueprint;
use Everest\Services\Email\EmailPolicyService;
use Everest\Services\Email\ResendPlanResolver;
use Everest\Services\Email\ResendQuotaService;
use Everest\Services\Email\EmailSettingsReader;
use Everest\Services\Email\EmailDeliveryTracker;
use Everest\Services\Email\ResendQuotaReservation;

class SendEmailJobResendQuotaTest extends TestCase
{
    public function setUp(): void
    {
        parent::setUp();

        $this->setUpEmailTables();

        $settingsReader = \Mockery::mock(EmailSettingsReader::class);
        $settingsReader->shouldReceive('transport')->andReturn('resend');
        $settingsReader->shouldReceive('deliveryEnabled')->andReturn(true);
        app()->instance(EmailSettingsReader::class, $settingsReader);

        $plan = [
            'key' => 'free',
            'name' => 'Free',
            'daily_limit' => 1,
            'monthly_limit' => 1,
            'enforce_daily' => true,
            'enforce_monthly' => true,
            'allows_custom_limits' => false,
            'custom_daily_limit' => null,
            'custom_monthly_limit' => null,
        ];

        $resolver = \Mockery::mock(ResendPlanResolver::class);
        $resolver->shouldReceive('activePlan')->andReturn($plan);
        $resolver->shouldReceive('all')->andReturn([$plan]);
        app()->instance(ResendPlanResolver::class, $resolver);

        // Seed quota at limit
        $quota = ResendQuota::singleton();
        $quota->daily_sent = 1;
        $quota->monthly_sent = 1;
        $quota->save();
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('deferred_emails');
        Schema::dropIfExists('email_delivery_attempts');
        Schema::dropIfExists('email_deliveries');
        Schema::dropIfExists('resend_quotas');

        \Mockery::close();
        parent::tearDown();
    }

    public function testResendPlanQuotaDefersEmail(): void
    {
        $emailManager = \Mockery::mock(EmailManager::class);
        $emailManager->shouldReceive('sendFromTemplate')->never();
        app()->instance(EmailManager::class, $emailManager);

        $policy = \Mockery::mock(EmailPolicyService::class);
        $policy->shouldReceive('isDeliveryEnabled')->andReturn(true);
        $policy->shouldReceive('isBlockedRecipient')->andReturn(false);
        $policy->shouldReceive('isTemplateEnabled')->andReturn(true);
        $policy->shouldReceive('validateTemplateData')->andReturn([['token' => 'abc'], []]);
        app()->instance(EmailPolicyService::class, $policy);

        $tracker = app(EmailDeliveryTracker::class);
        $quotaService = \Mockery::mock(ResendQuotaService::class);
        $quotaService->shouldReceive('reserve')
            ->once()
            ->andReturn(new ResendQuotaReservation(
                allowed: false,
                reason: 'monthly_quota_exceeded',
                scheduledAt: now()->addMinutes(15),
            ));
        app()->instance(ResendQuotaService::class, $quotaService);

        $job = new SendEmailJob(
            templateKey: 'auth.password_reset',
            recipient: 'quota@example.com',
            data: ['token' => 'abc'],
            userId: null,
            correlationId: 'corr-quota'
        );

        $job->handle($emailManager, $tracker, $policy, $quotaService);

        $this->assertDatabaseHas('deferred_emails', [
            'recipient' => 'quota@example.com',
            'reason' => 'monthly_quota_exceeded',
        ]);

        $this->assertSame(1, DeferredEmail::count());
    }

    private function setUpEmailTables(): void
    {
        Schema::dropIfExists('deferred_emails');
        Schema::dropIfExists('email_delivery_attempts');
        Schema::dropIfExists('email_deliveries');
        Schema::dropIfExists('resend_quotas');

        Schema::create('email_deliveries', function (Blueprint $table) {
            $table->id();
            $table->uuid('correlation_id')->nullable();
            $table->string('template_key')->nullable();
            $table->string('recipient');
            $table->unsignedInteger('user_id')->nullable();
            $table->string('subject')->default('');
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
            $table->string('provider')->nullable();
            $table->string('status');
            $table->unsignedInteger('response_code')->nullable();
            $table->unsignedInteger('status_code')->nullable();
            $table->string('provider_message_id')->nullable();
            $table->text('error_message')->nullable();
            $table->text('error')->nullable();
            $table->json('raw_response')->nullable();
            $table->text('response_payload')->nullable();
            $table->json('request_payload')->nullable();
            $table->timestamp('started_at')->nullable();
            $table->timestamp('finished_at')->nullable();
            $table->unsignedInteger('duration_ms')->nullable();
            $table->boolean('success')->default(false);
            $table->string('exception_class')->nullable();
            $table->longText('stacktrace')->nullable();
            $table->timestamps();
        });

        Schema::create('deferred_emails', function (Blueprint $table) {
            $table->id();
            $table->unsignedInteger('user_id')->nullable();
            $table->string('template_key');
            $table->string('recipient');
            $table->json('data')->nullable();
            $table->uuid('correlation_id')->nullable();
            $table->string('reason');
            $table->timestamp('scheduled_at');
            $table->timestamp('sent_at')->nullable();
            $table->unsignedInteger('attempts')->default(0);
            $table->timestamps();
        });

        Schema::create('resend_quotas', function (Blueprint $table) {
            $table->id();
            $table->unsignedInteger('daily_sent')->default(0);
            $table->unsignedInteger('monthly_sent')->default(0);
            $table->date('day_reset_at')->nullable();
            $table->date('month_reset_at')->nullable();
            $table->timestamps();
        });
    }
}

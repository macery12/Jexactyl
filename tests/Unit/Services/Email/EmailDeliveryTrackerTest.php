<?php

namespace Everest\Tests\Unit\Services\Email;

use Everest\Tests\TestCase;
use Everest\Models\EmailDelivery;
use Illuminate\Support\Facades\Schema;
use Everest\Models\EmailDeliveryAttempt;
use Illuminate\Database\Schema\Blueprint;
use Everest\Services\Email\EmailDeliveryTracker;

class EmailDeliveryTrackerTest extends TestCase
{
    private EmailDeliveryTracker $tracker;

    public function setUp(): void
    {
        parent::setUp();
        $this->setUpEmailTables();
        $this->tracker = new EmailDeliveryTracker();
    }

    protected function tearDown(): void
    {
        Schema::dropIfExists('email_delivery_attempts');
        Schema::dropIfExists('email_deliveries');

        parent::tearDown();
    }

    public function testStartDeliveryCreatesRecord(): void
    {
        $correlationId = 'test-correlation-' . uniqid();

        $delivery = $this->tracker->startDelivery(
            correlationId: $correlationId,
            recipient: 'test@example.com',
            subject: 'Test Subject',
            templateKey: 'auth.password_reset',
            userId: 1,
            tags: [['name' => 'test', 'value' => 'value']]
        );

        $this->assertInstanceOf(EmailDelivery::class, $delivery);
        $this->assertEquals($correlationId, $delivery->correlation_id);
        $this->assertEquals('test@example.com', $delivery->recipient);
        $this->assertEquals('Test Subject', $delivery->subject);
        $this->assertEquals('auth.password_reset', $delivery->template_key);
        $this->assertEquals(1, $delivery->user_id);
        $this->assertEquals('queued', $delivery->status);
        $this->assertEquals(0, $delivery->attempts);
    }

    public function testStartAttemptCreatesRecordAndUpdatesDelivery(): void
    {
        $delivery = $this->tracker->startDelivery(
            correlationId: 'test-' . uniqid(),
            recipient: 'test@example.com',
            subject: 'Test',
            templateKey: 'test.email'
        );

        $attempt = $this->tracker->startAttempt($delivery, 1);

        $this->assertInstanceOf(EmailDeliveryAttempt::class, $attempt);
        $this->assertEquals($delivery->id, $attempt->delivery_id);
        $this->assertEquals(1, $attempt->attempt_number);
        $this->assertEquals('sending', $attempt->status);
        $this->assertFalse($attempt->success);

        // Check delivery status updated
        $delivery->refresh();
        $this->assertEquals('sending', $delivery->status);
        $this->assertNotNull($delivery->last_attempt_at);
    }

    public function testFinishAttemptSuccessUpdatesRecords(): void
    {
        $delivery = $this->tracker->startDelivery(
            correlationId: 'test-' . uniqid(),
            recipient: 'test@example.com',
            subject: 'Test',
            templateKey: 'test.email'
        );

        $attempt = $this->tracker->startAttempt($delivery, 1);

        $this->tracker->finishAttemptSuccess(
            attempt: $attempt,
            providerMessageId: 'msg-123',
            statusCode: 200,
            responsePayload: ['id' => 'msg-123']
        );

        $attempt->refresh();
        $this->assertTrue($attempt->success);
        $this->assertEquals('sent', $attempt->status);
        $this->assertEquals('msg-123', $attempt->provider_message_id);
        $this->assertEquals(200, $attempt->status_code);
        $this->assertNotNull($attempt->finished_at);
        $this->assertNotNull($attempt->duration_ms);

        // Check delivery synced
        $delivery->refresh();
        $this->assertEquals('sent', $delivery->status);
        $this->assertEquals(1, $delivery->attempts);
        $this->assertEquals('msg-123', $delivery->last_message_id);
        $this->assertEquals(200, $delivery->last_status_code);
        $this->assertNotNull($delivery->sent_at);
    }

    public function testFinishAttemptFailureUpdatesRecords(): void
    {
        $delivery = $this->tracker->startDelivery(
            correlationId: 'test-' . uniqid(),
            recipient: 'test@example.com',
            subject: 'Test',
            templateKey: 'test.email'
        );

        $attempt = $this->tracker->startAttempt($delivery, 1);

        $exception = new \Exception('Test error');
        $this->tracker->finishAttemptFailure(
            attempt: $attempt,
            error: 'Test error',
            statusCode: 500,
            exception: $exception
        );

        $attempt->refresh();
        $this->assertFalse($attempt->success);
        $this->assertEquals('failed', $attempt->status);
        $this->assertEquals('Test error', $attempt->error);
        $this->assertEquals(500, $attempt->status_code);
        $this->assertNotNull($attempt->finished_at);

        // Check delivery synced
        $delivery->refresh();
        $this->assertEquals('failed', $delivery->status);
        $this->assertEquals(1, $delivery->attempts);
        $this->assertEquals('Test error', $delivery->last_error);
        $this->assertEquals(500, $delivery->last_status_code);
    }

    public function testMarkDeferredUpdatesStatus(): void
    {
        $delivery = $this->tracker->startDelivery(
            correlationId: 'test-' . uniqid(),
            recipient: 'test@example.com',
            subject: 'Test',
            templateKey: 'test.email'
        );

        $nextAvailable = now()->addHour();
        $this->tracker->markDeferred($delivery, 'daily_limit', $nextAvailable);

        $delivery->refresh();
        $this->assertEquals('deferred', $delivery->status);
        $this->assertStringContainsString('daily_limit', $delivery->last_error);
    }

    public function testMarkQueuedUpdatesStatus(): void
    {
        $delivery = $this->tracker->startDelivery(
            correlationId: 'test-' . uniqid(),
            recipient: 'test@example.com',
            subject: 'Test',
            templateKey: 'test.email'
        );

        $delivery->update([
            'status' => 'deferred',
            'last_error' => 'Rate limit exceeded',
        ]);

        $this->tracker->markQueued($delivery);

        $delivery->refresh();
        $this->assertEquals('queued', $delivery->status);
        $this->assertNull($delivery->last_error);
    }

    public function testMarkSkippedUpdatesStatus(): void
    {
        $delivery = $this->tracker->startDelivery(
            correlationId: 'test-' . uniqid(),
            recipient: 'test@example.com',
            subject: 'Test',
            templateKey: 'test.email'
        );

        $this->tracker->markSkipped($delivery, 'Email type disabled');

        $delivery->refresh();
        $this->assertEquals('skipped', $delivery->status);
        $this->assertEquals('Email type disabled', $delivery->last_error);
    }

    public function testGenerateDebugBundle(): void
    {
        $delivery = $this->tracker->startDelivery(
            correlationId: 'test-' . uniqid(),
            recipient: 'test@example.com',
            subject: 'Test',
            templateKey: 'test.email',
            userId: 1
        );

        $attempt = $this->tracker->startAttempt($delivery, 1);
        $this->tracker->finishAttemptSuccess($attempt, 'msg-123', 200);

        $bundle = $this->tracker->generateDebugBundle($delivery);

        $this->assertArrayHasKey('delivery', $bundle);
        $this->assertArrayHasKey('attempts', $bundle);
        $this->assertCount(1, $bundle['attempts']);
        $this->assertEquals('test@example.com', $bundle['delivery']['recipient']);
        $this->assertEquals('msg-123', $bundle['attempts'][0]['provider_message_id']);
    }

    public function testMultipleAttemptsIncrementCounter(): void
    {
        $delivery = $this->tracker->startDelivery(
            correlationId: 'test-' . uniqid(),
            recipient: 'test@example.com',
            subject: 'Test',
            templateKey: 'test.email'
        );

        // First attempt - fail
        $attempt1 = $this->tracker->startAttempt($delivery, 1);
        $this->tracker->finishAttemptFailure($attempt1, 'Error 1', 500);

        $delivery->refresh();
        $this->assertEquals(1, $delivery->attempts);
        $this->assertEquals('failed', $delivery->status);

        // Second attempt - fail
        $attempt2 = $this->tracker->startAttempt($delivery, 2);
        $this->tracker->finishAttemptFailure($attempt2, 'Error 2', 500);

        $delivery->refresh();
        $this->assertEquals(2, $delivery->attempts);

        // Third attempt - success
        $attempt3 = $this->tracker->startAttempt($delivery, 3);
        $this->tracker->finishAttemptSuccess($attempt3, 'msg-123', 200);

        $delivery->refresh();
        $this->assertEquals(3, $delivery->attempts);
        $this->assertEquals('sent', $delivery->status);

        // Verify all attempts exist
        $this->assertEquals(3, $delivery->deliveryAttempts()->count());
    }

    private function setUpEmailTables(): void
    {
        Schema::dropIfExists('users');
        Schema::dropIfExists('email_delivery_attempts');
        Schema::dropIfExists('email_deliveries');

        Schema::create('users', function (Blueprint $table) {
            $table->id();
            $table->string('email');
            $table->string('username');
        });

        Schema::create('email_deliveries', function (Blueprint $table) {
            $table->id();
            $table->uuid('correlation_id')->nullable();
            $table->string('template_key')->nullable();
            $table->string('recipient');
            $table->unsignedInteger('user_id')->nullable();
            $table->string('subject');
            $table->string('status')->default('queued');
            $table->string('provider')->nullable()->default('resend');
            $table->string('provider_message_id')->nullable();
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

        \Illuminate\Support\Facades\DB::table('users')->insert([
            'id' => 1,
            'email' => 'test@example.com',
            'username' => 'testuser',
        ]);
    }
}

<?php

namespace Everest\Tests\Unit\Services\Billing;

use Everest\Tests\TestCase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Everest\Exceptions\DisplayException;
use Illuminate\Database\Schema\Blueprint;
use Everest\Services\Billing\PayPalWebhookEventService;

class PayPalWebhookEventServiceTest extends TestCase
{
    private PayPalWebhookEventService $service;

    public function setUp(): void
    {
        parent::setUp();

        Schema::dropIfExists('paypal_webhook_events');
        Schema::create('paypal_webhook_events', function (Blueprint $table): void {
            $table->bigIncrements('id');
            $table->string('transmission_id')->unique();
            $table->string('payload_hash', 64);
            $table->string('status');
            $table->unsignedInteger('attempts')->default(0);
            $table->text('last_error')->nullable();
            $table->timestamps();
        });

        $this->service = new PayPalWebhookEventService();
    }

    public function testConcurrentRetryDoesNotProcessAnActiveEventTwice(): void
    {
        $payload = ['id' => 'WH-1', 'event_type' => 'PAYMENT.CAPTURE.COMPLETED'];

        $this->assertSame(
            PayPalWebhookEventService::RESULT_PROCESS,
            $this->service->begin('transmission-1', $payload)
        );
        $this->assertSame(
            PayPalWebhookEventService::RESULT_RETRY,
            $this->service->begin('transmission-1', $payload)
        );
        $this->assertSame(
            1,
            DB::table('paypal_webhook_events')->where('transmission_id', 'transmission-1')->value('attempts')
        );
    }

    public function testCompletedEventIsIdempotentlyAcknowledged(): void
    {
        $payload = ['id' => 'WH-2'];

        $this->assertSame(
            PayPalWebhookEventService::RESULT_PROCESS,
            $this->service->begin('transmission-2', $payload)
        );
        $this->service->complete('transmission-2');

        $this->assertSame(
            PayPalWebhookEventService::RESULT_COMPLETED,
            $this->service->begin('transmission-2', $payload)
        );
    }

    public function testFailedEventCanBeRetriedAndTracksAttempts(): void
    {
        $payload = ['id' => 'WH-3'];

        $this->service->begin('transmission-3', $payload);
        $this->service->fail('transmission-3', new \RuntimeException('temporary outage'));

        $this->assertSame(
            PayPalWebhookEventService::RESULT_PROCESS,
            $this->service->begin('transmission-3', $payload)
        );

        $row = DB::table('paypal_webhook_events')
            ->where('transmission_id', 'transmission-3')
            ->first();
        $this->assertSame(2, $row->attempts);
        $this->assertSame(PayPalWebhookEventService::STATUS_PROCESSING, $row->status);
        $this->assertNull($row->last_error);
    }

    public function testTransmissionIdCannotBeReusedWithDifferentPayload(): void
    {
        $this->service->begin('transmission-4', ['id' => 'WH-4']);

        $this->expectException(DisplayException::class);
        $this->expectExceptionMessage('reused with a different payload');

        $this->service->begin('transmission-4', ['id' => 'WH-TAMPERED']);
    }
}

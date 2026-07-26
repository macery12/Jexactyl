<?php

namespace Everest\Services\Billing;

use Illuminate\Support\Facades\DB;
use Everest\Exceptions\DisplayException;

class PayPalWebhookEventService
{
    public const STATUS_PROCESSING = 'processing';
    public const STATUS_COMPLETED = 'completed';
    public const STATUS_FAILED = 'failed';
    public const RESULT_PROCESS = 'process';
    public const RESULT_COMPLETED = 'completed';
    public const RESULT_RETRY = 'retry';

    /**
     * Begin or resume a verified event.
     *
     * @return string one of the RESULT_* constants
     */
    public function begin(string $transmissionId, array $payload): string
    {
        $payloadHash = hash('sha256', json_encode($payload, JSON_THROW_ON_ERROR));
        $inserted = DB::table('paypal_webhook_events')->insertOrIgnore([
            'transmission_id' => $transmissionId,
            'payload_hash' => $payloadHash,
            'status' => self::STATUS_PROCESSING,
            'attempts' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        if ($inserted === 1) {
            return self::RESULT_PROCESS;
        }

        return DB::transaction(function () use ($transmissionId, $payloadHash): string {
            $event = DB::table('paypal_webhook_events')
                ->where('transmission_id', $transmissionId)
                ->lockForUpdate()
                ->first();

            if ($event === null) {
                throw new \RuntimeException('The webhook event ledger row disappeared.');
            }

            if (!hash_equals((string) $event->payload_hash, $payloadHash)) {
                throw new DisplayException('A webhook transmission identifier was reused with a different payload.');
            }

            if ($event->status === self::STATUS_COMPLETED) {
                return self::RESULT_COMPLETED;
            }

            if (
                $event->status === self::STATUS_PROCESSING
                && \Carbon\CarbonImmutable::parse($event->updated_at)->isAfter(now()->subMinutes(5))
            ) {
                return self::RESULT_RETRY;
            }

            DB::table('paypal_webhook_events')
                ->where('id', $event->id)
                ->update([
                    'status' => self::STATUS_PROCESSING,
                    'attempts' => (int) $event->attempts + 1,
                    'last_error' => null,
                    'updated_at' => now(),
                ]);

            return self::RESULT_PROCESS;
        });
    }

    public function complete(string $transmissionId): void
    {
        DB::table('paypal_webhook_events')
            ->where('transmission_id', $transmissionId)
            ->update([
                'status' => self::STATUS_COMPLETED,
                'last_error' => null,
                'updated_at' => now(),
            ]);
    }

    public function fail(string $transmissionId, \Throwable $exception): void
    {
        DB::table('paypal_webhook_events')
            ->where('transmission_id', $transmissionId)
            ->update([
                'status' => self::STATUS_FAILED,
                'last_error' => mb_substr($exception->getMessage(), 0, 2000),
                'updated_at' => now(),
            ]);
    }
}

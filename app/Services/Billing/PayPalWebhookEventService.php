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
    public function begin(string $transmissionId, array $payload, ?string $paypalOrderId = null): string
    {
        $paypalOrderId = $this->sanitizeProviderIdentifier($paypalOrderId, 255);
        $eventType = $this->sanitizeProviderIdentifier($payload['event_type'] ?? null, 191);
        $payloadHash = hash('sha256', json_encode($payload, JSON_THROW_ON_ERROR));
        $inserted = DB::table('paypal_webhook_events')->insertOrIgnore([
            'transmission_id' => $transmissionId,
            'payload_hash' => $payloadHash,
            'event_type' => $eventType,
            'paypal_order_id' => $paypalOrderId,
            'status' => self::STATUS_PROCESSING,
            'attempts' => 1,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        if ($inserted === 1) {
            return self::RESULT_PROCESS;
        }

        return DB::transaction(function () use ($transmissionId, $payloadHash, $paypalOrderId, $eventType): string {
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

            if (
                $paypalOrderId !== null
                && $event->paypal_order_id !== null
                && !hash_equals((string) $event->paypal_order_id, $paypalOrderId)
            ) {
                throw new DisplayException('A webhook transmission identifier was reused for a different PayPal order.');
            }

            if ($paypalOrderId !== null && $event->paypal_order_id === null) {
                DB::table('paypal_webhook_events')
                    ->where('id', $event->id)
                    ->update([
                        'paypal_order_id' => $paypalOrderId,
                        'updated_at' => now(),
                    ]);
            }
            if ($eventType !== null && $event->event_type === null) {
                DB::table('paypal_webhook_events')
                    ->where('id', $event->id)
                    ->update([
                        'event_type' => $eventType,
                        'updated_at' => now(),
                    ]);
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

    private function sanitizeProviderIdentifier(mixed $value, int $maxLength): ?string
    {
        if (!is_string($value)) {
            return null;
        }

        $value = trim($value);
        if (
            $value === ''
            || mb_strlen($value) > $maxLength
            || preg_match('/\\A[A-Za-z0-9._:-]+\\z/', $value) !== 1
        ) {
            return null;
        }

        return $value;
    }
}

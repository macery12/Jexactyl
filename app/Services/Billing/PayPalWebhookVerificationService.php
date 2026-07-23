<?php

namespace Everest\Services\Billing;

use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Everest\Services\Security\LogSanitizer;

class PayPalWebhookVerificationService
{
    private const REPLAY_CACHE_TTL_DAYS = 30;
    private const TIMESTAMP_TOLERANCE_SECONDS = 300;

    private const REQUIRED_HEADERS = [
        'paypal-auth-algo' => 'auth_algo',
        'paypal-cert-url' => 'cert_url',
        'paypal-transmission-id' => 'transmission_id',
        'paypal-transmission-sig' => 'transmission_sig',
        'paypal-transmission-time' => 'transmission_time',
    ];

    public function __construct(private PayPalPaymentService $paypalService)
    {
    }

    public function validate(Request $request): array
    {
        $headers = [];
        $missingHeaders = [];

        foreach (self::REQUIRED_HEADERS as $headerName => $payloadKey) {
            $value = $request->header($headerName);
            if (!is_string($value) || trim($value) === '') {
                $missingHeaders[] = $headerName;
                continue;
            }

            $headers[$payloadKey] = trim($value);
        }

        if ($missingHeaders !== []) {
            return $this->failure(400, 'missing_signature_headers', [
                'event_type' => $request->input('event_type'),
                'missing_headers' => $missingHeaders,
            ]);
        }

        if (!$this->hasFreshTimestamp($headers['transmission_time'])) {
            return $this->failure(400, 'invalid_timestamp', [
                'event_type' => $request->input('event_type'),
                'transmission_id' => LogSanitizer::maskIdentifier($headers['transmission_id']),
            ]);
        }

        $event = $request->json()->all();
        if ($event === []) {
            return $this->failure(400, 'invalid_payload', [
                'transmission_id' => LogSanitizer::maskIdentifier($headers['transmission_id']),
            ]);
        }

        $signatureValid = $this->paypalService->verifyWebhookSignature(
            headers: $headers,
            webhookEvent: $event
        );

        if (!$signatureValid) {
            return $this->failure(401, 'invalid_signature', [
                'event_type' => $request->input('event_type'),
                'transmission_id' => LogSanitizer::maskIdentifier($headers['transmission_id']),
            ]);
        }

        $cacheKey = $this->replayCacheKey($headers['transmission_id']);
        if (!Cache::add($cacheKey, true, now()->addDays(self::REPLAY_CACHE_TTL_DAYS))) {
            return $this->failure(409, 'replayed_webhook', [
                'event_type' => $request->input('event_type'),
                'transmission_id' => LogSanitizer::maskIdentifier($headers['transmission_id']),
            ]);
        }

        return [
            'valid' => true,
            'event_type' => $request->input('event_type'),
            'transmission_id' => $headers['transmission_id'],
        ];
    }

    private function hasFreshTimestamp(string $timestamp): bool
    {
        try {
            $transmissionTime = CarbonImmutable::parse($timestamp);
        } catch (\Throwable) {
            return false;
        }

        return abs(now()->diffInSeconds($transmissionTime, false)) <= self::TIMESTAMP_TOLERANCE_SECONDS;
    }

    private function replayCacheKey(string $transmissionId): string
    {
        return 'billing:paypal:webhook:transmission:' . sha1($transmissionId);
    }

    private function failure(int $status, string $reason, array $context = []): array
    {
        return [
            'valid' => false,
            'status' => $status,
            'reason' => $reason,
            'context' => $context,
        ];
    }
}

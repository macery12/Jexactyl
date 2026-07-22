<?php

namespace Everest\Services\Email;

use Everest\Models\EmailDelivery;
use Illuminate\Support\Facades\Log;
use Everest\Models\EmailDeliveryAttempt;

/**
 * Central coordinator for email delivery tracking.
 * This is the ONLY service that should write to email_deliveries and email_delivery_attempts tables.
 */
class EmailDeliveryTracker
{
    /**
     * Check if debug mode is enabled for detailed logging.
     */
    private function isDebugMode(): bool
    {
        return config('app.debug') || config('mail.log_debug', false);
    }

    /**
     * Start a new email delivery.
     * Creates the initial delivery record with status 'queued'.
     */
    public function startDelivery(
        string $correlationId,
        string $recipient,
        string $subject,
        ?string $templateKey = null,
        ?int $userId = null,
        ?array $tags = null,
        string $provider = 'resend',
    ): EmailDelivery {
        Log::debug('EmailDeliveryTracker: Starting delivery', [
            'correlation_id' => $correlationId,
            'recipient' => $recipient,
            'template_key' => $templateKey,
        ]);

        $delivery = EmailDelivery::create([
            'correlation_id' => $correlationId,
            'template_key' => $templateKey,
            'recipient' => $recipient,
            'user_id' => $userId,
            'subject' => $subject,
            'provider' => $provider,
            'status' => EmailDelivery::STATUS_QUEUED,
            'attempts' => 0,
            'tags' => $tags,
        ]);

        return $delivery;
    }

    /**
     * Mark a delivery as deferred (rate-limited).
     */
    public function markDeferred(
        EmailDelivery $delivery,
        string $reason,
        \Carbon\Carbon $nextAvailableTime,
    ): void {
        Log::info('EmailDeliveryTracker: Marking as deferred', [
            'delivery_id' => $delivery->id,
            'correlation_id' => $delivery->correlation_id,
            'reason' => $reason,
            'next_available_at' => $nextAvailableTime,
        ]);

        $delivery->update([
            'status' => EmailDelivery::STATUS_DEFERRED,
            'last_error' => "Rate limit exceeded: {$reason}. Scheduled for: {$nextAvailableTime->toDateTimeString()}",
        ]);
    }

    /**
     * Mark a deferred delivery as queued again after handing it back to the job queue.
     */
    public function markQueued(EmailDelivery $delivery): void
    {
        Log::info('EmailDeliveryTracker: Marking as queued', [
            'delivery_id' => $delivery->id,
            'correlation_id' => $delivery->correlation_id,
        ]);

        $delivery->update([
            'status' => EmailDelivery::STATUS_QUEUED,
            'last_error' => null,
        ]);
    }

    /**
     * Mark a delivery as skipped (email sending disabled or notification type disabled).
     */
    public function markSkipped(EmailDelivery $delivery, string $reason): void
    {
        Log::info('EmailDeliveryTracker: Marking as skipped', [
            'delivery_id' => $delivery->id,
            'correlation_id' => $delivery->correlation_id,
            'reason' => $reason,
        ]);

        $delivery->update([
            'status' => EmailDelivery::STATUS_SKIPPED,
            'last_error' => $reason,
        ]);
    }

    /**
     * Start a new delivery attempt.
     * Creates an attempt record with status 'sending'.
     */
    public function startAttempt(
        EmailDelivery $delivery,
        int $attemptNumber,
        ?array $requestPayloadMeta = null,
    ): EmailDeliveryAttempt {
        Log::debug('EmailDeliveryTracker: Starting attempt', [
            'delivery_id' => $delivery->id,
            'correlation_id' => $delivery->correlation_id,
            'attempt_number' => $attemptNumber,
        ]);

        $delivery->update([
            'status' => EmailDelivery::STATUS_SENDING,
            'last_attempt_at' => now(),
        ]);

        // Store request payload only in debug mode
        $requestPayload = null;
        if ($this->isDebugMode() && $requestPayloadMeta) {
            $requestPayload = $this->sanitizePayload($requestPayloadMeta);
        }

        $attempt = EmailDeliveryAttempt::create([
            'delivery_id' => $delivery->id,
            'attempt_number' => $attemptNumber,
            'started_at' => now(),
            'status' => EmailDelivery::STATUS_SENDING,
            'success' => false,
            'request_payload' => $requestPayload,
        ]);

        return $attempt;
    }

    /**
     * Finish an attempt with success.
     */
    public function finishAttemptSuccess(
        EmailDeliveryAttempt $attempt,
        string $providerMessageId,
        ?int $statusCode = null,
        ?array $responsePayload = null,
    ): void {
        Log::info('EmailDeliveryTracker: Attempt succeeded', [
            'attempt_id' => $attempt->id,
            'delivery_id' => $attempt->delivery_id,
            'message_id' => $providerMessageId,
        ]);

        $attempt->finished_at = now();
        $attempt->calculateDuration();
        $attempt->success = true;
        $attempt->status = EmailDelivery::STATUS_SENT;
        $attempt->provider_message_id = $providerMessageId;
        $attempt->status_code = $statusCode;

        // Store response payload only in debug mode
        if ($this->isDebugMode() && $responsePayload) {
            $attempt->response_payload = json_encode($this->sanitizePayload($responsePayload));
        }

        $attempt->save();

        // Sync delivery status
        $this->syncDeliveryFromAttempt($attempt->delivery, $attempt);
    }

    /**
     * Finish an attempt with failure.
     */
    public function finishAttemptFailure(
        EmailDeliveryAttempt $attempt,
        string $error,
        ?int $statusCode = null,
        ?\Throwable $exception = null,
        ?array $responsePayload = null,
        ?bool $retryable = null,
    ): void {
        Log::warning('EmailDeliveryTracker: Attempt failed', [
            'attempt_id' => $attempt->id,
            'delivery_id' => $attempt->delivery_id,
            'error' => $error,
            'status_code' => $statusCode,
        ]);

        $attempt->finished_at = now();
        $attempt->calculateDuration();
        $attempt->success = false;
        $attempt->status = EmailDelivery::STATUS_FAILED;
        $attempt->error = $error;
        $attempt->status_code = $statusCode;
        if ($retryable !== null) {
            $attempt->error_message = $retryable ? 'retryable' : 'non-retryable';
        }

        // Store exception details only in debug mode
        if ($this->isDebugMode() && $exception) {
            $attempt->exception_class = get_class($exception);
            $attempt->stacktrace = $exception->getTraceAsString();
        }

        // Store response payload only in debug mode
        if ($this->isDebugMode() && $responsePayload) {
            $attempt->response_payload = json_encode($this->sanitizePayload($responsePayload));
        }

        $attempt->save();

        // Sync delivery status
        $this->syncDeliveryFromAttempt($attempt->delivery, $attempt);
    }

    /**
     * Sync delivery status from the latest attempt.
     * Updates: status, attempts count, last_message_id, last_status_code, last_error, sent_at.
     */
    public function syncDeliveryFromAttempt(EmailDelivery $delivery, EmailDeliveryAttempt $attempt): void
    {
        Log::debug('EmailDeliveryTracker: Syncing delivery from attempt', [
            'delivery_id' => $delivery->id,
            'attempt_id' => $attempt->id,
            'attempt_status' => $attempt->status,
        ]);

        $updateData = [
            'attempts' => $delivery->attempts + 1,
            'last_attempt_at' => $attempt->finished_at ?? $attempt->started_at,
            'last_status_code' => $attempt->status_code,
            'last_error' => $attempt->error,
        ];

        // Update status based on attempt result
        if ($attempt->success) {
            $updateData['status'] = EmailDelivery::STATUS_SENT;
            $updateData['sent_at'] = $attempt->finished_at;
            $updateData['last_message_id'] = $attempt->provider_message_id;
            // Keep provider_message_id in sync for legacy consumers that read from the delivery row
            $updateData['provider_message_id'] = $attempt->provider_message_id;
        } else {
            $updateData['status'] = EmailDelivery::STATUS_FAILED;
        }

        $delivery->update($updateData);
    }

    /**
     * Sanitize payload to redact sensitive information.
     */
    private function sanitizePayload(array $payload): array
    {
        return EmailRedactor::redactSensitivePayload($payload, ['api_key', 'token', 'password', 'secret', 'authorization', 'apiKey']);
    }

    /**
     * Generate debug bundle for a delivery.
     * Returns array with delivery and all attempts, including debug data if enabled.
     */
    public function generateDebugBundle(EmailDelivery $delivery): array
    {
        $delivery->load(['deliveryAttempts', 'user:id,email,username']);

        $bundle = [
            'delivery' => [
                'id' => $delivery->id,
                'correlation_id' => $delivery->correlation_id,
                'template_key' => $delivery->template_key,
                'recipient' => $delivery->recipient,
                'user' => $delivery->user ? [
                    'id' => $delivery->user->id,
                    'email' => $delivery->user->email,
                    'username' => $delivery->user->username,
                ] : null,
                'subject' => $delivery->subject,
                'provider' => $delivery->provider,
                'status' => $delivery->status,
                'attempts' => $delivery->attempts,
                'last_attempt_at' => $delivery->last_attempt_at?->toIso8601String(),
                'sent_at' => $delivery->sent_at?->toIso8601String(),
                'last_message_id' => $delivery->last_message_id,
                'last_status_code' => $delivery->last_status_code,
                'last_error' => $delivery->last_error,
                'tags' => $delivery->tags,
                'created_at' => $delivery->created_at->toIso8601String(),
                'updated_at' => $delivery->updated_at->toIso8601String(),
            ],
            'attempts' => [],
        ];

        foreach ($delivery->deliveryAttempts as $attempt) {
            $attemptData = [
                'id' => $attempt->id,
                'attempt_number' => $attempt->attempt_number,
                'started_at' => $attempt->started_at->toIso8601String(),
                'finished_at' => $attempt->finished_at?->toIso8601String(),
                'duration_ms' => $attempt->duration_ms,
                'success' => $attempt->success,
                'status' => $attempt->status,
                'provider_message_id' => $attempt->provider_message_id,
                'status_code' => $attempt->status_code,
                'error' => $attempt->error,
            ];

            // Include debug data if available
            if ($this->isDebugMode()) {
                $attemptData['request_payload'] = $attempt->request_payload;
                $attemptData['response_payload'] = $attempt->response_payload;
                $attemptData['exception_class'] = $attempt->exception_class;
                $attemptData['stacktrace'] = $attempt->stacktrace;
            }

            $bundle['attempts'][] = $attemptData;
        }

        return $bundle;
    }

    /**
     * Find existing delivery by correlation ID.
     */
    public function findByCorrelationId(string $correlationId): ?EmailDelivery
    {
        return EmailDelivery::where('correlation_id', $correlationId)->first();
    }
}

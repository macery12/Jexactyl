<?php

namespace Everest\Jobs\Email;

use Everest\Jobs\Job;
use Illuminate\Bus\Queueable;
use Everest\Models\EmailQuota;
use Everest\Models\DeferredEmail;
use Illuminate\Support\Facades\Log;
use Illuminate\Queue\SerializesModels;
use Everest\Services\Email\EmailManager;
use Illuminate\Queue\Attributes\Timeout;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Everest\Models\EmailNotificationSetting;
use Everest\Services\Email\EmailPolicyService;
use Everest\Services\Email\ResendQuotaService;
use Illuminate\Queue\Attributes\MaxExceptions;
use Everest\Services\Email\EmailDeliveryTracker;
use Everest\Services\Email\EmailSubjectResolver;
use Illuminate\Queue\Middleware\ThrottlesExceptions;

/**
 * Runs on the `mail` lane. Password resets and payment receipts are the most
 * latency-sensitive work the panel queues, so they get their own worker rather
 * than sharing one with hour-long installs.
 */
#[Timeout(120)]
#[MaxExceptions(2)]
class SendEmailJob extends Job implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    /**
     * The number of times the job may be attempted.
     */
    public $tries = 3;

    /**
     * The number of seconds to wait before retrying.
     */
    public $backoff = [60, 300, 900]; // 1min, 5min, 15min

    /**
     * When the mail provider is down, every queued email fails in turn and each
     * one pays the full backoff. Circuit-breaking after a handful of failures
     * parks the rest cheaply instead of grinding the worker through the backlog,
     * and they resume on their own once the provider recovers.
     */
    public function middleware(): array
    {
        return [(new ThrottlesExceptions(5, 300))->by('email-provider')];
    }

    /**
     * Create a new job instance.
     * Note: correlationId should ALWAYS be provided by EmailNotificationListener.
     *
     * @param array|null $invoiceAttachment Optional: ['file_path' => ..., 'file_disk' => ..., 'filename' => ...]
     */
    public function __construct(
        public string $templateKey,
        public string $recipient,
        public array $data,
        public ?int $userId = null,
        public ?string $correlationId = null,
        public ?array $invoiceAttachment = null,
    ) {
        // Ensure we have correlation_id (fallback only for direct job dispatch)
        $this->correlationId = $correlationId ?? \Illuminate\Support\Str::uuid()->toString();
    }

    /**
     * Execute the job.
     */
    public function handle(EmailManager $emailManager, EmailDeliveryTracker $tracker, EmailPolicyService $policy, ResendQuotaService $resendQuotaService): void
    {
        if (!$policy->isDeliveryEnabled()) {
            Log::info('SendEmailJob: Email delivery disabled, skipping dispatch', [
                'template_key' => $this->templateKey,
                'recipient' => $this->recipient,
                'correlation_id' => $this->correlationId,
            ]);

            return;
        }

        Log::info('SendEmailJob: Starting', [
            'template_key' => $this->templateKey,
            'recipient' => $this->recipient,
            'correlation_id' => $this->correlationId,
            'attempt' => $this->attempts(),
        ]);

        $provider = EmailManager::getTransport();

        // Hard block invalid or blacklisted recipients before any processing
        if ($policy->isBlockedRecipient($this->recipient)) {
            $delivery = $tracker->startDelivery(
                correlationId: $this->correlationId,
                recipient: $this->recipient,
                subject: $this->getSubjectForTemplate($this->templateKey),
                templateKey: $this->templateKey,
                userId: $this->userId,
                tags: $this->buildTags(),
                provider: $provider
            );

            $tracker->markSkipped($delivery, 'Blocked recipient email');

            Log::warning('SendEmailJob: Blocked recipient email, skipping send', [
                'template_key' => $this->templateKey,
                'recipient' => $this->recipient,
                'correlation_id' => $this->correlationId,
            ]);

            return;
        }

        // Get subject for the email
        $subject = $this->getSubjectForTemplate($this->templateKey);

        // Check for existing delivery or create new one
        $delivery = $tracker->findByCorrelationId($this->correlationId);

        if (!$delivery) {
            // First attempt - create delivery record
            $delivery = $tracker->startDelivery(
                correlationId: $this->correlationId,
                recipient: $this->recipient,
                subject: $subject,
                templateKey: $this->templateKey,
                userId: $this->userId,
                tags: $this->buildTags(),
                provider: $provider
            );
        }

        // Check if this email type is enabled (template-level)
        if (!$policy->isTemplateEnabled($this->templateKey)) {
            $reason = "Email type '{$this->templateKey}' is disabled";

            Log::info('SendEmailJob: Email type disabled', [
                'template_key' => $this->templateKey,
                'correlation_id' => $this->correlationId,
                'reason' => $reason,
            ]);

            $tracker->markSkipped($delivery, $reason);

            return;
        }

        // Check rate limiting (if user ID provided and not exempt)
        if ($this->userId && !EmailNotificationSetting::isRateLimitExempt($this->templateKey)) {
            $quota = EmailQuota::getOrCreateForUser($this->userId);

            if (!$quota->reserveQuota(1)) {
                // Quota exceeded - defer the email
                $nextAvailable = $quota->getNextAvailableTime();
                $reason = $quota->daily_limit && $quota->daily_sent >= $quota->daily_limit
                    ? 'daily_limit'
                    : 'monthly_limit';

                Log::info('SendEmailJob: Quota exceeded, deferring', [
                    'template_key' => $this->templateKey,
                    'user_id' => $this->userId,
                    'reason' => $reason,
                    'scheduled_at' => $nextAvailable,
                    'correlation_id' => $this->correlationId,
                ]);

                $tracker->markDeferred($delivery, $reason, $nextAvailable);

                DeferredEmail::create([
                    'user_id' => $this->userId,
                    'template_key' => $this->templateKey,
                    'recipient' => $this->recipient,
                    'data' => $this->data,
                    'correlation_id' => $this->correlationId,
                    'reason' => $reason,
                    'scheduled_at' => $nextAvailable,
                ]);

                return;
            }
        }

        // Validate variables
        [$validData, $errors] = $policy->validateTemplateData($this->templateKey, $this->data);

        if (!empty($errors)) {
            Log::error('SendEmailJob: Variable validation failed', [
                'template_key' => $this->templateKey,
                'errors' => $errors,
                'correlation_id' => $this->correlationId,
            ]);

            throw new \Exception('Variable validation failed: ' . implode(', ', $errors));
        }

        if ($provider === 'resend' && $this->attempts() === 1) {
            $reservation = $resendQuotaService->reserve();

            if (!$reservation->allowed) {
                $nextAvailable = $reservation->scheduledAt ?? now()->addMinutes(5);
                $reason = $reservation->reason ?? 'resend_quota_reached';

                Log::info('SendEmailJob: Resend plan quota exceeded, deferring', [
                    'template_key' => $this->templateKey,
                    'recipient' => $this->recipient,
                    'reason' => $reason,
                    'scheduled_at' => $nextAvailable,
                    'correlation_id' => $this->correlationId,
                ]);

                $tracker->markDeferred($delivery, $reason, $nextAvailable);

                DeferredEmail::create([
                    'user_id' => $this->userId,
                    'template_key' => $this->templateKey,
                    'recipient' => $this->recipient,
                    'data' => $validData,
                    'correlation_id' => $this->correlationId,
                    'reason' => $reason,
                    'scheduled_at' => $nextAvailable,
                ]);

                return;
            }
        }

        // Resolve invoice attachment bytes if present
        $attachments = null;
        if (!empty($this->invoiceAttachment)) {
            try {
                $content = \Illuminate\Support\Facades\Storage::disk($this->invoiceAttachment['file_disk'])
                    ->get($this->invoiceAttachment['file_path']);
                if ($content) {
                    $attachments = [[
                        'filename' => $this->invoiceAttachment['filename'],
                        'content' => $content,
                        'content_type' => 'application/pdf',
                    ]];
                }
            } catch (\Throwable $e) {
                Log::warning('SendEmailJob: Could not read invoice attachment, sending email without it', [
                    'error' => $e->getMessage(),
                    'correlation_id' => $this->correlationId,
                ]);
            }
        }

        // Send the email - EmailManager will use tracker to log attempts
        $result = $emailManager->sendFromTemplate(
            templateKey: $this->templateKey,
            recipient: $this->recipient,
            data: $validData,
            correlationId: $this->correlationId,
            userId: $this->userId,
            delivery: $delivery,
            attemptNumber: $this->attempts(),
            attachments: $attachments
        );

        if (!$result->success && $provider === 'resend' && $result->statusCode === 429) {
            $reason = $result->reason;
            if (in_array($reason, ['daily_quota_exceeded', 'monthly_quota_exceeded'], true)) {
                $reasonKey = $reason === 'daily_quota_exceeded' ? 'resend_daily_quota_reached' : 'resend_monthly_quota_reached';
                $nextAvailable = isset($result->meta['rate_limit']['reset']) && $result->meta['rate_limit']['reset']
                    ? now()->addSeconds((int) $result->meta['rate_limit']['reset'])
                    : now()->addMinutes(15);

                Log::info('SendEmailJob: Resend provider quota exceeded, deferring', [
                    'reason' => $reasonKey,
                    'scheduled_at' => $nextAvailable,
                    'correlation_id' => $this->correlationId,
                ]);

                $tracker->markDeferred($delivery, $reasonKey, $nextAvailable);

                DeferredEmail::create([
                    'user_id' => $this->userId,
                    'template_key' => $this->templateKey,
                    'recipient' => $this->recipient,
                    'data' => $validData,
                    'correlation_id' => $this->correlationId,
                    'reason' => $reasonKey,
                    'scheduled_at' => $nextAvailable,
                ]);

                return;
            }
        }

        if (!$result->success) {
            if ($result->retryable === false) {
                Log::warning('SendEmailJob: Non-retryable failure, stopping retries', [
                    'template_key' => $this->templateKey,
                    'recipient' => $this->recipient,
                    'error' => $result->error,
                    'correlation_id' => $this->correlationId,
                ]);

                return;
            }

            throw new \Exception($result->error ?? 'Unknown error');
        }

        Log::info('SendEmailJob: Email sent successfully', [
            'template_key' => $this->templateKey,
            'recipient' => $this->recipient,
            'message_id' => $result->messageId,
            'correlation_id' => $this->correlationId,
        ]);
    }

    /**
     * Handle a job failure.
     */
    public function failed(\Throwable $exception): void
    {
        Log::error('SendEmailJob: Job failed permanently', [
            'template_key' => $this->templateKey,
            'recipient' => $this->recipient,
            'error' => $exception->getMessage(),
            'correlation_id' => $this->correlationId,
        ]);

        // The final attempt failure has already been logged by EmailManager
        // No additional action needed here
    }

    /**
     * Get subject for template.
     */
    private function getSubjectForTemplate(string $templateKey): string
    {
        return EmailSubjectResolver::forTracking($templateKey);
    }

    /**
     * Build tags for the email.
     */
    private function buildTags(): array
    {
        return [
            [
                'name' => 'template_key',
                'value' => $this->templateKey,
            ],
            [
                'name' => 'correlation_id',
                'value' => $this->correlationId,
            ],
        ];
    }
}

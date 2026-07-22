<?php

namespace Everest\Services\Email;

use Everest\Models\EmailDelivery;
use Illuminate\Support\Facades\Log;
use Everest\Services\Email\Emails\BaseEmail;
use Everest\Services\Email\Transports\SmtpTransport;
use Everest\Exceptions\Service\Email\ResendException;
use Everest\Services\Email\Emails\CustomMessageEmail;
use Everest\Services\Email\Transports\EmailTransport;
use Everest\Services\Email\Transports\ResendTransport;
use Everest\Services\Email\Templating\EmailTemplateRenderer;
use Everest\Exceptions\Service\Email\ResendValidationException;
use Everest\Exceptions\Service\Email\ResendAuthenticationException;

class EmailManager
{
    /**
     * Send an email using a BaseEmail type.
     *
     * @throws ResendException
     */
    public function send(BaseEmail $email, string $recipient): EmailResult
    {
        $transportResolution = $this->resolveTransportConfig();
        if ($transportResolution instanceof EmailResult) {
            return $transportResolution;
        }
        [$transport, $from, $fromName, $replyTo] = $transportResolution;

        Log::info('EmailManager: Using transport', [
            'transport' => $transport->getName(),
            'subject' => $email->subject(),
            'from' => $from,
            'reply_to' => $replyTo,
        ]);

        // Render HTML content
        $html = $this->renderHtml($email, ['replyTo' => $replyTo]);

        // Get or generate text content
        $text = $email->text() ?? $this->htmlToText($html);

        // Create email message
        $message = new EmailMessage(
            to: $recipient,
            subject: $email->subject(),
            html: $html,
            text: $text,
            tags: $email->tags(),
            from: $from,
            fromName: $fromName,
            replyTo: $replyTo
        );

        return $transport->send($message);
    }

    /**
     * Send a custom email with raw HTML.
     */
    public function sendCustom(
        string $to,
        string $subject,
        string $html,
        ?string $text = null,
    ): EmailResult {
        $customEmail = new CustomMessageEmail(
            subject: $subject,
            html: $html,
            text: $text,
            tags: [
                [
                    'name' => 'category',
                    'value' => 'custom',
                ],
            ]
        );

        return $this->send($customEmail, $to);
    }

    /**
     * Send an email from a template key.
     * This is the main method used by the event-driven email system.
     *
     * @param EmailDelivery|null $delivery Pre-created delivery record from SendEmailJob
     * @param int $attemptNumber Current attempt number (1-based, from job retry count)
     */
    public function sendFromTemplate(
        string $templateKey,
        string $recipient,
        array $data,
        string $correlationId,
        ?int $userId = null,
        ?EmailDelivery $delivery = null,
        int $attemptNumber = 1,
        ?array $attachments = null,
    ): EmailResult {
        $tracker = app(EmailDeliveryTracker::class);
        $transportName = self::getTransport();

        if (!in_array($transportName, ['smtp', 'resend'], true)) {
            return $this->handleConfigFailure(
                tracker: $tracker,
                delivery: $delivery,
                attemptNumber: $attemptNumber,
                message: 'Invalid email transport configured: ' . $transportName
            );
        }

        // If no delivery provided, create one (for direct calls outside job system)
        if (!$delivery) {
            $subject = $this->getSubjectForTemplate($templateKey);
            $tags = [
                ['name' => 'template_key', 'value' => $templateKey],
                ['name' => 'correlation_id', 'value' => $correlationId],
            ];

            try {
                $delivery = $tracker->startDelivery(
                    correlationId: $correlationId,
                    recipient: $recipient,
                    subject: $subject,
                    templateKey: $templateKey,
                    userId: $userId,
                    tags: $tags,
                    provider: $transportName
                );
            } catch (\Exception $e) {
                // If tables don't exist, log clear error message
                Log::error('EmailDeliveryTracker failed to create delivery - tables may not exist', [
                    'error' => $e->getMessage(),
                    'correlation_id' => $correlationId,
                    'hint' => 'Run "php artisan migrate" to create email_deliveries and email_delivery_attempts tables',
                ]);

                // Continue sending email even if logging fails
                // Create a temporary delivery object to avoid null reference errors
                $delivery = new EmailDelivery([
                    'id' => 0,
                    'correlation_id' => $correlationId,
                    'recipient' => $recipient,
                    'subject' => $subject,
                    'template_key' => $templateKey,
                    'user_id' => $userId,
                    'status' => 'queued',
                    'attempts' => 0,
                    'provider' => $transportName,
                ]);
            }
        }

        $transportResolution = $this->resolveTransportConfig($tracker, $delivery, $attemptNumber);
        if ($transportResolution instanceof EmailResult) {
            return $transportResolution;
        }
        [$transport, $from, $fromName, $replyTo] = $transportResolution;

        Log::info('EmailManager: Using transport', [
            'transport' => $transport->getName(),
            'template_key' => $templateKey,
            'correlation_id' => $correlationId,
            'from' => $from,
            'reply_to' => $replyTo,
        ]);

        // Convert template key to view path (auth.password_reset -> emails.auth.password-reset)
        // Split on first dot to get category and action
        $parts = explode('.', $templateKey, 2);
        if (count($parts) === 2) {
            // auth.password_reset -> emails.auth.password-reset
            $viewPath = 'emails.' . $parts[0] . '.' . str_replace('_', '-', $parts[1]);
        } else {
            // Fallback for unexpected format
            $viewPath = 'emails.' . $templateKey;
        }

        // Get subject from template key
        $subject = $this->getSubjectForTemplate($templateKey);

        // Render HTML content from template
        try {
            $html = $this->renderViewWithCustomOverride($viewPath, array_merge($data, ['replyTo' => $replyTo]));
        } catch (\Exception $e) {
            $error = 'Failed to render email template: ' . $e->getMessage();
            Log::error($error, [
                'template_key' => $templateKey,
                'view_path' => $viewPath,
                'correlation_id' => $correlationId,
            ]);

            $attempt = $tracker->startAttempt($delivery, $attemptNumber);
            $tracker->finishAttemptFailure($attempt, $error, 0, $e, null, false);

            return EmailResult::failure($error, null, false);
        }

        // Generate text content
        $text = $this->htmlToText($html);

        // Create tags
        $tags = [
            [
                'name' => 'template_key',
                'value' => $templateKey,
            ],
            [
                'name' => 'correlation_id',
                'value' => $correlationId,
            ],
        ];

        // Create email message
        $message = new EmailMessage(
            to: $recipient,
            subject: $subject,
            html: $html,
            text: $text,
            tags: $tags,
            from: $from,
            fromName: $fromName,
            replyTo: $replyTo,
            attachments: $attachments
        );

        // Start attempt tracking (with error handling)
        $requestPayload = $message->toArray();
        $attempt = null;
        try {
            $attempt = $tracker->startAttempt($delivery, $attemptNumber, $requestPayload);
        } catch (\Exception $e) {
            Log::warning('Failed to create delivery attempt record', [
                'error' => $e->getMessage(),
                'correlation_id' => $correlationId,
            ]);
        }

        // Send via selected transport
        try {
            $result = $transport->send($message);

            if ($result->success) {
                if (isset($result->meta['usage']) || isset($result->meta['rate_limit'])) {
                    $this->syncResendUsage($result->meta);
                }

                // Success - update attempt if it was created
                if ($attempt) {
                    try {
                        $tracker->finishAttemptSuccess(
                            attempt: $attempt,
                            providerMessageId: $result->messageId,
                            statusCode: $result->statusCode,
                            responsePayload: ['id' => $result->messageId]
                        );
                    } catch (\Exception $e) {
                        Log::warning('Failed to update attempt success', [
                            'error' => $e->getMessage(),
                            'correlation_id' => $correlationId,
                        ]);
                    }
                }
            } else {
                if (isset($result->meta['usage']) || isset($result->meta['rate_limit'])) {
                    $this->syncResendUsage($result->meta);
                }
                // Failure - update attempt if it was created
                if ($attempt) {
                    try {
                        $tracker->finishAttemptFailure(
                            attempt: $attempt,
                            error: $result->error ?? 'Unknown error',
                            statusCode: $result->statusCode,
                            exception: null,
                            responsePayload: null,
                            retryable: $result->retryable
                        );
                    } catch (\Exception $e) {
                        Log::warning('Failed to update attempt failure', [
                            'error' => $e->getMessage(),
                            'correlation_id' => $correlationId,
                        ]);
                    }
                }
            }

            return $result;
        } catch (\Exception $e) {
            $retryable = !($e instanceof ResendAuthenticationException || $e instanceof ResendValidationException);

            // Exception during send - update attempt if it was created
            if ($attempt) {
                try {
                    $tracker->finishAttemptFailure(
                        attempt: $attempt,
                        error: $e->getMessage(),
                        statusCode: method_exists($e, 'getCode') ? $e->getCode() : 0,
                        exception: $e,
                        responsePayload: null,
                        retryable: $retryable
                    );
                } catch (\Exception $logException) {
                    Log::warning('Failed to update attempt exception', [
                        'error' => $logException->getMessage(),
                        'correlation_id' => $correlationId,
                    ]);
                }
            }

            return EmailResult::failure($e->getMessage(), $e->getCode(), $retryable);
        }
    }

    /**
     * Render HTML from email template.
     */
    private function renderHtml(BaseEmail $email, array $extraData = []): string
    {
        // CustomMessageEmail uses direct HTML
        if ($email instanceof CustomMessageEmail) {
            return $email->getHtml();
        }

        // Merge any extra data (e.g. resolved replyTo for the footer)
        return $this->renderViewWithCustomOverride($email->view(), array_merge($email->data(), $extraData));
    }

    /**
     * Render an email template, using the admin-saved custom override when one exists.
     *
     * Templates are Twig, rendered under a sandbox by EmailTemplateRenderer. They used to
     * be Blade, which compiles to PHP -- an operator-editable body was therefore arbitrary
     * code execution as the web user. Nothing here may reintroduce a path that hands
     * template source to a compiler outside the sandbox.
     *
     * The renderer owns override lookup and view-name validation, so both live in one
     * place rather than being duplicated between here and the admin controller.
     */
    private function renderViewWithCustomOverride(string $viewPath, array $data): string
    {
        return app(EmailTemplateRenderer::class)->render($viewPath, $data);
    }

    /**
     * Convert HTML to plain text.
     */
    private function htmlToText(string $html): string
    {
        // Remove script and style tags
        $html = preg_replace('/<script\b[^>]*>(.*?)<\/script>/is', '', $html);
        $html = preg_replace('/<style\b[^>]*>(.*?)<\/style>/is', '', $html);

        // Convert common HTML tags to text equivalents
        $html = str_replace('<br>', "\n", $html);
        $html = str_replace('<br/>', "\n", $html);
        $html = str_replace('<br />', "\n", $html);
        $html = str_replace('</p>', "\n\n", $html);
        $html = str_replace('</div>', "\n", $html);
        $html = str_replace('</h1>', "\n\n", $html);
        $html = str_replace('</h2>', "\n\n", $html);
        $html = str_replace('</h3>', "\n\n", $html);

        // Strip remaining HTML tags
        $text = strip_tags($html);

        // Decode HTML entities
        $text = html_entity_decode($text, ENT_QUOTES | ENT_HTML5, 'UTF-8');

        // Clean up whitespace
        $text = preg_replace('/[ \t]+/', ' ', $text); // Multiple spaces to single space
        $text = preg_replace('/\n\s+\n/', "\n\n", $text); // Clean up blank lines
        $text = trim($text);

        return $text;
    }

    private function syncResendUsage(array $meta): void
    {
        if (!isset($meta['usage']) && !isset($meta['rate_limit'])) {
            return;
        }

        $usage = $meta['usage'] ?? [];
        $rate = $meta['rate_limit'] ?? [];

        try {
            app(ResendQuotaService::class)->syncFromProvider(
                $usage['daily_used'] ?? null,
                $usage['monthly_used'] ?? null,
                $rate
            );
        } catch (\Throwable $e) {
            Log::debug('EmailManager: failed syncing Resend usage headers', ['error' => $e->getMessage()]);
        }
    }

    /**
     * Check if Resend email is enabled.
     */
    public static function isDeliveryEnabled(): bool
    {
        return app(EmailSettingsReader::class)->deliveryEnabled();
    }

    public static function getTransport(): string
    {
        return app(EmailSettingsReader::class)->transport();
    }

    /**
     * Validate and attempt a connection for a specific transport using the configured settings.
     */
    public function testTransport(string $transport): EmailResult
    {
        $normalized = strtolower($transport);
        if (!in_array($normalized, ['smtp', 'resend'], true)) {
            return EmailResult::failure('Unsupported transport: ' . $transport, 400, false);
        }

        $resolution = $this->resolveTransportConfig(
            tracker: null,
            delivery: null,
            attemptNumber: 1,
            forcedTransport: $normalized
        );

        if ($resolution instanceof EmailResult) {
            return $resolution;
        }

        [$transportInstance, $from, $fromName, $replyTo] = $resolution;

        $message = new EmailMessage(
            to: $from,
            subject: 'Email provider connection check',
            html: '<p>This provider connection check reached the configured sender address successfully.</p>',
            text: 'This provider connection check reached the configured sender address successfully.',
            from: $from,
            fromName: $fromName,
            replyTo: $replyTo
        );

        $result = $transportInstance->send($message);

        if ($transport === 'resend' && isset($result->meta)) {
            $this->syncResendUsage($result->meta);
        }

        return $result;
    }

    /**
     * Resolve the configured transport and validate configuration.
     *
     * @return array{0: EmailTransport, 1: string, 2: string|null, 3: string|null}|EmailResult
     */
    private function resolveTransportConfig(
        ?EmailDeliveryTracker $tracker = null,
        ?EmailDelivery $delivery = null,
        int $attemptNumber = 1,
        ?string $forcedTransport = null,
    ): EmailResult|array {
        $settings = app(EmailSettingsReader::class);
        $transportName = $forcedTransport ?? self::getTransport();

        if ($delivery && $delivery->provider !== $transportName) {
            $delivery->provider = $transportName;

            if ($delivery->id) {
                $delivery->save();
            }
        }

        if ($transportName === 'smtp') {
            $config = [
                'host' => $settings->get('settings::modules:email:smtp:host'),
                'port' => $settings->get('settings::modules:email:smtp:port'),
                'username' => $settings->get('settings::modules:email:smtp:username'),
                'password' => $settings->get('settings::modules:email:smtp:password'),
                'encryption' => $settings->get('settings::modules:email:smtp:encryption'),
            ];

            $from = $settings->get('settings::modules:email:smtp:from_email');
            $fromName = $settings->get('settings::modules:email:smtp:from_name');
            // Reply-to should stay within the SMTP identity; fall back to the same "from" address
            $replyTo = $settings->get('settings::modules:email:smtp:reply_to') ?: $from;

            $requiredMissing = [];
            if (empty($config['host'])) {
                $requiredMissing[] = 'host';
            }

            if ($config['port'] === null || $config['port'] === '') {
                $requiredMissing[] = 'port';
            }

            if ($from === null || $from === '') {
                $requiredMissing[] = 'from';
            }

            if (!empty($config['username']) && ($config['password'] === null || $config['password'] === '')) {
                $requiredMissing[] = 'password (set in Admin → Email → SMTP password)';
            }

            if (!empty($requiredMissing)) {
                return $this->handleConfigFailure(
                    tracker: $tracker,
                    delivery: $delivery,
                    attemptNumber: $attemptNumber,
                    message: 'SMTP configuration missing required fields: ' . implode(', ', $requiredMissing)
                );
            }

            if (!filter_var($from, FILTER_VALIDATE_EMAIL)) {
                return $this->handleConfigFailure(
                    tracker: $tracker,
                    delivery: $delivery,
                    attemptNumber: $attemptNumber,
                    message: 'From email address has invalid format: ' . $from . '. Please check the "From Email" in Admin → Email settings.'
                );
            }

            return [
                new SmtpTransport($config),
                $from,
                $fromName,
                $replyTo,
            ];
        }

        // Default to Resend
        $apiKey = $settings->get('settings::modules:email:resend:api_key');
        if (empty($apiKey)) {
            return $this->handleConfigFailure(
                tracker: $tracker,
                delivery: $delivery,
                attemptNumber: $attemptNumber,
                message: 'Resend API key not configured. Please configure the API key in Admin → Email settings.'
            );
        }

        $from = $settings->get('settings::modules:email:resend:from_email');
        $fromName = $settings->get('settings::modules:email:resend:from_name');
        // Keep reply-to aligned with the Resend identity; fall back to the same "from" address
        $replyTo = $settings->get('settings::modules:email:resend:reply_to') ?: $from;

        if (empty($from)) {
            return $this->handleConfigFailure(
                tracker: $tracker,
                delivery: $delivery,
                attemptNumber: $attemptNumber,
                message: 'From email address not configured. Please set the "From Email" in Admin → Email settings.'
            );
        }

        if (!filter_var($from, FILTER_VALIDATE_EMAIL)) {
            return $this->handleConfigFailure(
                tracker: $tracker,
                delivery: $delivery,
                attemptNumber: $attemptNumber,
                message: 'From email address has invalid format: ' . $from . '. Please check the "From Email" in Admin → Email settings.'
            );
        }

        return [
            new ResendTransport($apiKey),
            $from,
            $fromName,
            $replyTo,
        ];
    }

    private function handleConfigFailure(
        ?EmailDeliveryTracker $tracker,
        ?EmailDelivery $delivery,
        int $attemptNumber,
        string $message,
    ): EmailResult {
        Log::error($message);

        if ($tracker && $delivery) {
            $attempt = $tracker->startAttempt($delivery, $attemptNumber);
            $tracker->finishAttemptFailure($attempt, $message, 0, null, null, false);
        }

        return EmailResult::failure($message, 422, false);
    }

    /**
     * Get email subject for a template key.
     */
    private function getSubjectForTemplate(string $templateKey): string
    {
        return EmailSubjectResolver::forDelivery($templateKey);
    }
}

<?php

namespace Everest\Services\Email\Transports;

use Illuminate\Mail\Message;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Everest\Services\Email\EmailResult;
use Everest\Services\Email\EmailMessage;

class SmtpTransport implements EmailTransport
{
    public function __construct(private array $config)
    {
    }

    public function getName(): string
    {
        return 'smtp';
    }

    public function send(EmailMessage $message): EmailResult
    {
        $encryption = $this->config['encryption'] ?? null;
        if ($encryption === '') {
            $encryption = null;
        }

        // Ensure the SMTP mailer is rebuilt with fresh credentials/config for this send.
        Mail::forgetMailers();

        // Apply runtime mail configuration for SMTP
        $rawPort = $this->config['port'] ?? null;
        $configuredPort = ($rawPort === '' || $rawPort === null) ? null : (int) $rawPort;

        config([
            'mail.default' => 'smtp',
            'mail.mailers.smtp' => [
                'transport' => 'smtp',
                'host' => $this->config['host'] ?? null,
                'port' => $configuredPort,
                'username' => $this->config['username'] ?? null,
                'password' => $this->config['password'] ?? null,
                'encryption' => $encryption,
                'timeout' => $this->config['timeout'] ?? null,
                'auth_mode' => null,
            ],
            'mail.from.address' => $message->from,
            'mail.from.name' => $message->fromName,
        ]);

        try {
            Mail::mailer('smtp')->html($message->html, function (Message $mail) use ($message) {
                $mail->to($message->to)
                    ->from($message->from, $message->fromName)
                    ->subject($message->subject);

                if ($message->text) {
                    $mail->text($message->text);
                }

                if ($message->replyTo) {
                    $mail->replyTo($message->replyTo);
                }

                if (!empty($message->attachments)) {
                    foreach ($message->attachments as $att) {
                        $mail->attachData(
                            $att['content'],
                            $att['filename'],
                            ['mime' => $att['content_type'] ?? 'application/octet-stream']
                        );
                    }
                }
            });

            // Laravel's Mail::send does not expose provider message id; use a generated id for tracking consistency
            $generatedId = $this->generateTrackingMessageId();

            return new EmailResult(
                success: true,
                messageId: $generatedId,
                statusCode: 200
            );
        } catch (\Throwable $e) {
            $errorMessage = $e->getMessage();
            $retryable = !(
                stripos($errorMessage, 'authentication') !== false
                || stripos($errorMessage, 'username and password not accepted') !== false
                || stripos($errorMessage, 'invalid credentials') !== false
                || stripos($errorMessage, 'missing credentials') !== false
            );

            Log::error('SMTP send failed', [
                'error' => $errorMessage,
                'retryable' => $retryable,
            ]);

            return EmailResult::failure($errorMessage, $e->getCode() ?: null, $retryable);
        }
    }

    private function generateTrackingMessageId(): string
    {
        return sprintf(
            '%s@%s',
            bin2hex(random_bytes(16)),
            parse_url(config('app.url'), PHP_URL_HOST) ?: 'smtp.local'
        );
    }
}

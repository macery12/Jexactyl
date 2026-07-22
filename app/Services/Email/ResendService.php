<?php

namespace Everest\Services\Email;

use Everest\Exceptions\Service\Email\ResendException;

class ResendService
{
    private ResendHttpClient $client;

    public function __construct(string $apiKey)
    {
        $this->client = new ResendHttpClient($apiKey);
    }

    /**
     * Send an email using Resend API.
     *
     * Returns EmailResult with structured response data.
     * NO logging - that's handled by higher-level services (EmailManager, EmailDeliveryTracker).
     *
     * @throws ResendException
     */
    public function send(EmailMessage $message): EmailResult
    {
        try {
            $payload = $message->toArray();
            $response = $this->client->sendEmail($payload);

            $messageId = $response['body']['id'] ?? null;
            $statusCode = $response['status_code'] ?? null;
            $meta = $response['meta'] ?? [];
            $errorFromResponse = $response['error'] ?? ($response['body']['message'] ?? null);
            $reason = $response['body']['name'] ?? $response['body']['type'] ?? null;

            if (!$messageId) {
                return new EmailResult(
                    success: false,
                    error: $errorFromResponse ?? 'Response missing message ID',
                    statusCode: $statusCode,
                    reason: $reason,
                    // 429 quota / rate limit should not be retried automatically here
                    retryable: $statusCode !== 429,
                    meta: $meta
                );
            }

            return new EmailResult(
                success: true,
                messageId: $messageId,
                statusCode: $statusCode,
                meta: $meta
            );
        } catch (ResendException $e) {
            $retryable = !($e instanceof \Everest\Exceptions\Service\Email\ResendAuthenticationException
                || $e instanceof \Everest\Exceptions\Service\Email\ResendValidationException);

            return new EmailResult(
                success: false,
                error: $e->getMessage(),
                statusCode: $e->getCode(),
                retryable: $retryable
            );
        }
    }
}

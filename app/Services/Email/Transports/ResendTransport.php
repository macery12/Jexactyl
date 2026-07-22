<?php

namespace Everest\Services\Email\Transports;

use Everest\Services\Email\EmailResult;
use Everest\Services\Email\EmailMessage;
use Everest\Services\Email\ResendService;

class ResendTransport implements EmailTransport
{
    public function __construct(private string $apiKey)
    {
    }

    public function getName(): string
    {
        return 'resend';
    }

    public function send(EmailMessage $message): EmailResult
    {
        $service = new ResendService($this->apiKey);

        return $service->send($message);
    }
}

<?php

namespace Everest\Listeners\Email;

use Illuminate\Support\Facades\Log;
use Everest\Jobs\Email\SendEmailJob;
use Everest\Services\Email\EmailTypeRegistry;
use Everest\Services\Email\EmailSettingsReader;

class EmailNotificationListener
{
    public function __construct(private EmailSettingsReader $settings)
    {
    }

    /**
     * Handle email notification events.
     */
    public function handle(object $event): void
    {
        if (!$this->settings->deliveryEnabled()) {
            Log::info('EmailNotificationListener: Skipping dispatch because email delivery is disabled', [
                'event' => get_class($event),
            ]);

            return;
        }

        // Get template key for this event
        $templateKey = EmailTypeRegistry::getTemplateKey($event);

        if (!$templateKey) {
            Log::debug('EmailNotificationListener: No template mapping for event', [
                'event' => get_class($event),
            ]);

            return;
        }

        // Extract recipient
        $recipient = EmailTypeRegistry::getRecipient($event);

        if (!$recipient) {
            Log::warning('EmailNotificationListener: No recipient found for event', [
                'event' => get_class($event),
                'template_key' => $templateKey,
            ]);

            return;
        }

        // Extract data
        $data = EmailTypeRegistry::extractDataFromEvent($event);

        // Generate or get correlation ID (ONLY generate here, never in EmailManager)
        $correlationId = EmailTypeRegistry::getCorrelationId($event)
            ?? \Illuminate\Support\Str::uuid()->toString();

        // Get user ID if available
        $userId = property_exists($event, 'user') && $event->user ? $event->user->id : null;

        // Collect invoice attachment data if present on event
        $invoiceAttachment = null;
        if (
            $event instanceof \Everest\Events\Email\PaymentReceived
            && $event->invoiceFilePath
            && $event->invoiceFileDisk
        ) {
            $invoiceAttachment = [
                'file_path' => $event->invoiceFilePath,
                'file_disk' => $event->invoiceFileDisk,
                'filename' => $event->invoiceFileName ?? 'invoice.pdf',
            ];
        }

        Log::info('EmailNotificationListener: Dispatching email', [
            'event' => get_class($event),
            'template_key' => $templateKey,
            'recipient' => $recipient,
            'correlation_id' => $correlationId,
            'has_invoice_attachment' => $invoiceAttachment !== null,
        ]);

        // Dispatch the job
        SendEmailJob::dispatch(
            $templateKey,
            $recipient,
            $data,
            $userId,
            $correlationId,
            $invoiceAttachment
        );
    }

    /**
     * Register the listeners for the subscriber.
     */
    public function subscribe($events): array
    {
        $mappings = EmailTypeRegistry::getAllMappings();
        $listeners = [];

        foreach ($mappings as $eventClass => $templateKey) {
            $listeners[$eventClass] = 'handle';
        }

        return $listeners;
    }
}

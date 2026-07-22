<?php

namespace Everest\Jobs\Email;

use Everest\Jobs\Job;
use Illuminate\Bus\Queueable;
use Everest\Models\DeferredEmail;
use Illuminate\Support\Facades\Log;
use Illuminate\Queue\SerializesModels;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Everest\Services\Email\EmailDeliveryTracker;

class ProcessDeferredEmailsJob extends Job implements ShouldQueue
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    /**
     * Execute the job.
     */
    public function handle(EmailDeliveryTracker $tracker): void
    {
        $pendingEmails = DeferredEmail::getPendingEmails(100);

        foreach ($pendingEmails as $deferred) {
            Log::info('ProcessDeferredEmailsJob: Dispatching deferred email', [
                'deferred_id' => $deferred->id,
                'template_key' => $deferred->template_key,
                'user_id' => $deferred->user_id,
            ]);

            SendEmailJob::dispatch(
                $deferred->template_key,
                $deferred->recipient,
                $deferred->data,
                $deferred->user_id,
                $deferred->correlation_id
            );

            if ($deferred->correlation_id && ($delivery = $tracker->findByCorrelationId($deferred->correlation_id))) {
                $tracker->markQueued($delivery);
            }

            $deferred->delete();
        }
    }
}

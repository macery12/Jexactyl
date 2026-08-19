<?php

namespace Everest\Jobs\Email;

use Everest\Jobs\Job;
use Illuminate\Bus\Queueable;
use Everest\Models\DeferredEmail;
use Illuminate\Support\Facades\Log;
use Illuminate\Queue\Attributes\Tries;
use Illuminate\Queue\SerializesModels;
use Illuminate\Queue\Attributes\Timeout;
use Illuminate\Queue\InteractsWithQueue;
use Illuminate\Queue\Attributes\UniqueFor;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Everest\Services\Email\EmailDeliveryTracker;
use Illuminate\Contracts\Queue\ShouldBeUniqueUntilProcessing;

/**
 * Hands deferred emails — those parked by a quota refusal or a provider 429 —
 * back to the mail queue once their scheduled time arrives.
 *
 * Duplicate protection is deliberately layered, because a duplicate here means
 * a customer gets the same email twice:
 *
 *  1. `ShouldBeUniqueUntilProcessing` stops a second copy being queued while
 *     one is already waiting. Uniqueness is released as processing starts, so
 *     the next five-minute tick is never blocked by the run in flight.
 *  2. `withoutOverlapping()` on the schedule entry stops the command stacking.
 *  3. `DeferredEmail::claimPending()` is the one that actually matters — it
 *     claims rows atomically, so even a manual `p:email:process-deferred`
 *     racing cron cannot pick up rows this run already owns.
 */
#[Timeout(60)]
#[Tries(1)]
#[UniqueFor(300)]
class ProcessDeferredEmailsJob extends Job implements ShouldQueue, ShouldBeUniqueUntilProcessing
{
    use Dispatchable;
    use InteractsWithQueue;
    use Queueable;
    use SerializesModels;

    /**
     * One batch at a time panel-wide. There is no per-user variant of this job.
     */
    public function uniqueId(): string
    {
        return 'deferred-emails';
    }

    /**
     * Execute the job.
     */
    public function handle(EmailDeliveryTracker $tracker): void
    {
        $pendingEmails = DeferredEmail::claimPending(100);

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

            // Marked rather than deleted, so the row stays as evidence that the
            // email was deferred and then released. `sent_at` is what keeps it
            // out of the next claim.
            $deferred->markDispatched();
        }
    }
}

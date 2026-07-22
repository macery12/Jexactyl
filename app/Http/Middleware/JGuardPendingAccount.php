<?php

namespace Everest\Http\Middleware;

use Illuminate\Http\Request;
use Everest\Models\JGuardEntry;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;

class JGuardPendingAccount
{
    /**
     * Block access for accounts that are awaiting jGuard approval.
     *
     * For accounts registered under 'delayed' mode, the entry is automatically
     * approved once the configured delay period has elapsed.
     *
     * @throws AccessDeniedHttpException
     */
    public function handle(Request $request, \Closure $next): mixed
    {
        $user = $request->user();

        if (!$user || $user->state !== 'pending') {
            return $next($request);
        }

        // Look up the jGuard entry for this user.
        $entry = JGuardEntry::where('user_id', $user->id)
            ->where('status', JGuardEntry::STATUS_PENDING)
            ->first();

        if (!$entry) {
            // No pending entry found — clear the stale state and allow through.
            $user->update(['state' => null]);

            return $next($request);
        }

        // Auto-approve if the delay period has elapsed for 'delayed' mode accounts.
        if ($entry->approval_mode === JGuardEntry::MODE_DELAYED && $entry->isExpired()) {
            $entry->update(['status' => JGuardEntry::STATUS_APPROVED]);
            $user->update(['state' => null]);

            return $next($request);
        }

        throw new AccessDeniedHttpException('Your account is pending approval by an administrator.');
    }
}

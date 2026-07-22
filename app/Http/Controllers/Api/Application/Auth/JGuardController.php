<?php

namespace Everest\Http\Controllers\Api\Application\Auth;

use Everest\Models\User;
use Everest\Models\Setting;
use Everest\Facades\Activity;
use Illuminate\Http\Response;
use Everest\Models\JGuardEntry;
use Illuminate\Http\JsonResponse;
use Everest\Http\Requests\Api\Application\Auth\GetJGuardRequest;
use Everest\Http\Controllers\Api\Application\ApplicationApiController;
use Everest\Http\Requests\Api\Application\Auth\UpdateAuthModuleRequest;

class JGuardController extends ApplicationApiController
{
    public function __construct()
    {
        parent::__construct();
    }

    /**
     * Return a list of all users with a jGuard entry (pending, approved, or rejected).
     */
    public function index(GetJGuardRequest $request): JsonResponse
    {
        $status = $request->query('status', 'pending');

        $entries = JGuardEntry::with('user')
            ->where('status', $status)
            ->orderByDesc('created_at')
            ->get();

        // Remove entries whose user has been deleted.
        $orphanIds = $entries->filter(fn (JGuardEntry $e) => $e->user === null)->pluck('id');
        if ($orphanIds->isNotEmpty()) {
            JGuardEntry::whereIn('id', $orphanIds)->delete();
        }

        $data = $entries
            ->filter(fn (JGuardEntry $e) => $e->user !== null)
            ->map(fn (JGuardEntry $entry) => [
                'id' => $entry->id,
                'user_id' => $entry->user_id,
                'username' => $entry->user->username,
                'email' => $entry->user->email,
                'status' => $entry->status,
                'approval_mode' => $entry->approval_mode,
                'expires_at' => $entry->expires_at?->toIso8601String(),
                'created_at' => $entry->created_at?->toIso8601String(),
            ])
            ->values();

        return response()->json(['data' => $data]);
    }

    /**
     * Approve a pending user account, granting them full access.
     */
    public function approve(UpdateAuthModuleRequest $request, int $userId): Response
    {
        $user = User::find($userId);

        if (!$user) {
            JGuardEntry::where('user_id', $userId)->delete();

            abort(404, 'User no longer exists; the pending entry has been removed.');
        }

        JGuardEntry::where('user_id', $user->id)
            ->where('status', JGuardEntry::STATUS_PENDING)
            ->update(['status' => JGuardEntry::STATUS_APPROVED]);

        $user->update(['state' => null]);

        Activity::event('admin:jguard:approve')
            ->property('user', $user)
            ->description('A jGuard pending user was approved')
            ->log();

        return $this->returnNoContent();
    }

    /**
     * Reject a pending user account, revoking their access permanently.
     */
    public function reject(UpdateAuthModuleRequest $request, int $userId): Response
    {
        $user = User::find($userId);

        if (!$user) {
            JGuardEntry::where('user_id', $userId)->delete();

            abort(404, 'User no longer exists; the pending entry has been removed.');
        }

        JGuardEntry::where('user_id', $user->id)
            ->where('status', JGuardEntry::STATUS_PENDING)
            ->update(['status' => JGuardEntry::STATUS_REJECTED]);

        $user->update(['state' => 'suspended']);

        Activity::event('admin:jguard:reject')
            ->property('user', $user)
            ->description('A jGuard pending user was rejected')
            ->log();

        return $this->returnNoContent();
    }

    /**
     * Update the jGuard module settings (approval_mode, delay).
     */
    public function settings(UpdateAuthModuleRequest $request): Response
    {
        $validated = $request->validate([
            'approval_mode' => 'sometimes|string|in:manual,delayed',
            'delay' => 'sometimes|integer|min:0',
            'pending_message' => 'sometimes|nullable|string|max:500',
        ]);

        foreach ($validated as $key => $value) {
            Setting::set('settings::modules:auth:jguard:' . $key, $value);
        }

        Activity::event('admin:jguard:settings')
            ->property('changes', $validated)
            ->description('jGuard settings were updated')
            ->log();

        return $this->returnNoContent();
    }
}

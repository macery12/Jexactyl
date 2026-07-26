<?php

namespace Everest\Http\Controllers\Api\Application\Alerts;

use Everest\Models\User;
use Everest\Models\Alert;
use Everest\Facades\Activity;
use Illuminate\Http\JsonResponse;
use Everest\Http\Requests\Api\Application\Alerts\GetAlertsRequest;
use Everest\Http\Requests\Api\Application\Alerts\CreateAlertRequest;
use Everest\Http\Requests\Api\Application\Alerts\DeleteAlertRequest;
use Everest\Http\Requests\Api\Application\Alerts\UpdateAlertRequest;
use Everest\Http\Controllers\Api\Application\ApplicationApiController;
use Everest\Http\Requests\Api\Application\Alerts\SearchAlertUsersRequest;

class AlertController extends ApplicationApiController
{
    /**
     * AlertController constructor.
     */
    public function __construct()
    {
        parent::__construct();
    }

    /**
     * Get all alerts.
     */
    public function index(GetAlertsRequest $request): JsonResponse
    {
        $alerts = Alert::with('users:id,email,username')
            ->orderByDesc('priority')
            ->orderByDesc('created_at')
            ->get();

        return new JsonResponse($alerts);
    }

    /**
     * Get active alerts for display to users.
     */
    public function active(): JsonResponse
    {
        $alerts = Alert::active()->get();

        return new JsonResponse($alerts);
    }

    /**
     * Create a new alert.
     */
    public function store(CreateAlertRequest $request): JsonResponse
    {
        $data = $request->validated();
        $userIds = $data['user_ids'] ?? [];
        unset($data['user_ids']);

        $alert = Alert::create($data);

        // Attach users if specific targeting
        if ($alert->user_targeting === 'specific' && !empty($userIds)) {
            $alert->users()->attach($userIds);
        }

        Activity::event('admin:alert:create')
            ->property('alert_id', $alert->id)
            ->property('data', $alert->toArray())
            ->description('Created a new alert')
            ->log();

        return new JsonResponse($alert->load('users:id,email,username'), 201);
    }

    /**
     * Update an existing alert.
     */
    public function updateAlert(UpdateAlertRequest $request, Alert $alert): JsonResponse
    {
        $data = $request->validated();
        $userIds = $data['user_ids'] ?? null;
        unset($data['user_ids']);

        $alert->update($data);

        // Sync users if targeting changed or user_ids provided
        if ($userIds !== null) {
            if ($alert->user_targeting === 'specific') {
                $alert->users()->sync($userIds);
            } else {
                $alert->users()->detach();
            }
        }

        Activity::event('admin:alert:update')
            ->property('alert_id', $alert->id)
            ->property('data', $alert->toArray())
            ->description('Updated alert')
            ->log();

        return new JsonResponse($alert->load('users:id,email,username'));
    }

    /**
     * Delete an alert.
     */
    public function destroy(DeleteAlertRequest $request, Alert $alert): JsonResponse
    {
        Activity::event('admin:alert:delete')
            ->property('alert_id', $alert->id)
            ->description('Deleted alert')
            ->log();

        $alert->delete();

        return new JsonResponse(null, 204);
    }

    /**
     * Search for users by email or username.
     */
    public function searchUsers(SearchAlertUsersRequest $request): JsonResponse
    {
        $query = $request->input('q', '');
        $limit = min($request->input('limit', 10), 50);

        if (strlen($query) < 2) {
            return new JsonResponse([]);
        }

        $users = User::where('email', 'LIKE', "%{$query}%")
            ->orWhere('username', 'LIKE', "%{$query}%")
            ->select(['id', 'email', 'username'])
            ->limit($limit)
            ->get();

        return new JsonResponse($users);
    }
}

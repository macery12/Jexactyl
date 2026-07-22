<?php

namespace Everest\Http\Controllers\Api\Client;

use Everest\Facades\Activity;
use Illuminate\Http\Response;
use Everest\Models\UserSession;
use Illuminate\Http\JsonResponse;
use Everest\Services\Auth\UserSessionService;
use Everest\Http\Requests\Api\Client\ClientApiRequest;
use Everest\Transformers\Api\Client\UserSessionTransformer;

class SessionController extends ClientApiController
{
    public function __construct(private UserSessionService $service)
    {
        parent::__construct();
    }

    /**
     * List active sessions for the authenticated user.
     */
    public function index(ClientApiRequest $request): array
    {
        $sessions = $request->user()->sessions()
            ->whereNull('revoked_at')
            ->orderByDesc('last_activity_at')
            ->orderByDesc('created_at')
            ->get();

        return $this->fractal->collection($sessions)
            ->transformWith(UserSessionTransformer::class)
            ->toArray();
    }

    /**
     * List all sessions including revoked ones (for history view).
     */
    public function history(ClientApiRequest $request): array
    {
        $sessions = $request->user()->sessions()
            ->whereNotNull('revoked_at')
            ->orderByDesc('revoked_at')
            ->limit(20)
            ->get();

        return $this->fractal->collection($sessions)
            ->transformWith(UserSessionTransformer::class)
            ->toArray();
    }

    /**
     * Revoke a single session.
     */
    public function revoke(ClientApiRequest $request, UserSession $session): JsonResponse
    {
        abort_unless($session->user_id === $request->user()->id, Response::HTTP_NOT_FOUND);

        $this->service->revokeSession($request->user(), $session);

        Activity::withRequestMetadata()
            ->subject($request->user())
            ->event('auth:session_revoked')
            ->property('session_db_id', $session->id)
            ->log();

        return new JsonResponse([], Response::HTTP_NO_CONTENT);
    }

    /**
     * Revoke all sessions for the user.
     */
    public function revokeAll(ClientApiRequest $request): JsonResponse
    {
        $includeCurrent = $request->boolean('include_current', false);
        $except = null;

        if (!$includeCurrent && $request->hasSession()) {
            $except = $request->session()->getId();
        }

        $this->service->revokeAll($request->user(), $except);

        Activity::withRequestMetadata()
            ->subject($request->user())
            ->event('auth:session_revoked')
            ->property('all', true)
            ->property('include_current', $includeCurrent)
            ->log();

        if ($includeCurrent && $request->hasSession()) {
            $request->session()->invalidate();
            $request->session()->regenerateToken();
        }

        return new JsonResponse([], Response::HTTP_NO_CONTENT);
    }

    /**
     * Set a user-defined label for a session.
     */
    public function updateLabel(ClientApiRequest $request, UserSession $session): JsonResponse
    {
        abort_unless($session->user_id === $request->user()->id, Response::HTTP_NOT_FOUND);

        $label = $request->input('label');
        $session->update(['device_label' => $label ? mb_substr(trim($label), 0, 100) : null]);

        return new JsonResponse([], Response::HTTP_NO_CONTENT);
    }
}

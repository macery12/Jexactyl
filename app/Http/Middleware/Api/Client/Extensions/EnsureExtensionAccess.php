<?php

namespace Everest\Http\Middleware\Api\Client\Extensions;

use Everest\Models\Server;
use Everest\Models\Subuser;
use Illuminate\Http\Request;
use Everest\Models\ExtensionConfig;
use Symfony\Component\HttpFoundation\Response;

class EnsureExtensionAccess
{
    /**
     * Ensure the extension is enabled for the server and not disabled for the current subuser.
     */
    public function handle(Request $request, \Closure $next, string $extensionId): Response
    {
        /** @var \Everest\Models\User $user */
        $user = $request->user();

        $server = $request->route()?->parameter('server');
        if (!$server instanceof Server) {
            return response('', 404);
        }

        $config = ExtensionConfig::getByExtensionId($extensionId);
        if (!$config || !$config->isServerEligible($server)) {
            return response('', 404);
        }

        if ($user->isOwner() || $server->owner_id === $user->id) {
            return $next($request);
        }

        $subuser = Subuser::query()
            ->where('user_id', $user->id)
            ->where('server_id', $server->id)
            ->first();

        if ($subuser && in_array($extensionId, $subuser->disabled_extensions ?? [], true)) {
            return response()->json([
                'error' => 'This extension has been disabled for your account by the server owner.',
            ], 403);
        }

        return $next($request);
    }
}

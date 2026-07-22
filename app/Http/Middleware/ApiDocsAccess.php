<?php

namespace Everest\Http\Middleware;

use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Http\JsonResponse;

class ApiDocsAccess
{
    public function handle(Request $request, \Closure $next)
    {
        if (!config('api-docs.enabled')) {
            return $this->errorResponse(
                $request,
                503,
                'API documentation is disabled. Set API_DOCS_ENABLED=true to enable /api/docs and /api/openapi.json.'
            );
        }

        if (config('api-docs.admin_only')) {
            $user = $request->user();

            if (!$user) {
                return $this->errorResponse(
                    $request,
                    401,
                    'Authentication required to access API documentation.'
                );
            }

            if (!$user->root_admin && empty($user->admin_role_id)) {
                return $this->errorResponse(
                    $request,
                    403,
                    'Admin access is required to view API documentation.'
                );
            }
        }

        return $next($request);
    }

    private function errorResponse(Request $request, int $status, string $message): Response|JsonResponse
    {
        $wantsJson = $request->expectsJson() || str_ends_with($request->path(), 'openapi.json');

        if ($wantsJson) {
            return response()->json([
                'errors' => [
                    [
                        'status' => (string) $status,
                        'detail' => $message,
                    ],
                ],
            ], $status);
        }

        return response($message, $status)
            ->header('Content-Type', 'text/plain; charset=UTF-8');
    }
}

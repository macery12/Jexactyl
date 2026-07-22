<?php

namespace Everest\Http\Middleware\Api\Application\Extensions;

use Illuminate\Http\Request;
use Everest\Models\ExtensionConfig;
use Everest\Models\ExtensionPackage;
use Symfony\Component\HttpFoundation\Response;

/**
 * Gates extension-contributed admin API routes (routes/admin.php inside a
 * package). Admin authentication itself is inherited from the application-api
 * middleware stack that wraps the whole route file; this middleware only adds
 * the extension-level checks: module on, package installed, config enabled.
 */
class EnsureExtensionAdminAccess
{
    public function handle(Request $request, \Closure $next, string $extensionId): Response
    {
        if (!config('modules.extensions.enabled')) {
            return response('', 404);
        }

        if (!ExtensionPackage::query()->where('extension_id', $extensionId)->exists()) {
            return response('', 404);
        }

        $config = ExtensionConfig::getByExtensionId($extensionId);
        if (!$config || !$config->enabled) {
            return response('', 404);
        }

        return $next($request);
    }
}

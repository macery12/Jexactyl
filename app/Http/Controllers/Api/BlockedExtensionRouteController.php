<?php

namespace Everest\Http\Controllers\Api;

use Everest\Http\Controllers\Controller;
use Symfony\Component\HttpFoundation\Response;

/**
 * Serves extension-contributed routes that failed the runtime route-guard
 * audit (see ExtensionRouteGuardService). The offending handler is never
 * invoked; the route answers 404 as if it did not exist. A real controller —
 * rather than a closure — keeps the neutralized route compatible with
 * route:cache.
 */
class BlockedExtensionRouteController extends Controller
{
    public function __invoke(): Response
    {
        return response('', 404);
    }
}

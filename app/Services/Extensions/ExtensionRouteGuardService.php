<?php

namespace Everest\Services\Extensions;

use Illuminate\Routing\Route;
use Illuminate\Support\Facades\Route as RouteFacade;
use Everest\Http\Controllers\Api\BlockedExtensionRouteController;

/**
 * Runtime defense-in-depth for package-contributed route files.
 *
 * The repo-side scanner already rejects `withoutMiddleware()` statically, but
 * a hostile or corrupted package that slipped past review could still strip
 * its inherited admin/client guards at boot. This service re-checks the actual
 * route objects immediately after each package route file is require()'d —
 * which also covers `route:cache`, since the audit runs while the cache is
 * being built and its verdict is baked into the cached routes.
 *
 * A route that fails the audit is dropped: its action is swapped for
 * BlockedExtensionRouteController (a plain 404) while its middleware stack is
 * restored, and the violation is reported loudly via report(). The rest of the
 * panel — and the extension's compliant routes — keep working.
 */
class ExtensionRouteGuardService
{
    /**
     * Runs $register (which must require() the package route file, wrapped in
     * whatever groups apply) and audits exactly the routes it added.
     *
     * @param string[] $requiredMiddleware middleware aliases (e.g.
     *                                     "extensions.admin:<id>", "throttle:api.ext-admin") every registered
     *                                     route must carry; empty when the surface has none to assert
     */
    public function registerAndAudit(string $extensionId, array $requiredMiddleware, callable $register): void
    {
        $collection = RouteFacade::getRoutes();

        $known = [];
        foreach ($collection->getRoutes() as $route) {
            $known[spl_object_id($route)] = true;
        }

        $register();

        foreach ($collection->getRoutes() as $route) {
            if (!isset($known[spl_object_id($route)])) {
                $this->audit($route, $extensionId, $requiredMiddleware);
            }
        }
    }

    /**
     * @param string[] $requiredMiddleware
     */
    private function audit(Route $route, string $extensionId, array $requiredMiddleware): void
    {
        $violations = [];

        // withoutMiddleware() is the boot-time escape hatch: exclusions are
        // applied when the middleware stack is resolved for dispatch, so a
        // route can shed the admin auth it appears to inherit. Extensions have
        // no legitimate reason to exclude anything.
        if ($route->excludedMiddleware() !== []) {
            $violations[] = sprintf(
                'excludes inherited middleware [%s]',
                implode(', ', array_map($this->middlewareName(...), $route->excludedMiddleware()))
            );
        }

        foreach ($requiredMiddleware as $required) {
            if (!in_array($required, $route->middleware(), true)) {
                $violations[] = sprintf('does not carry the required "%s" middleware', $required);
            }
        }

        if ($violations === []) {
            return;
        }

        $this->drop($route);

        report(new \RuntimeException(sprintf(
            'Extension route audit: dropped [%s] /%s from extension "%s" because the route %s. It now returns 404.',
            implode('|', $route->methods()),
            $route->uri(),
            $extensionId,
            implode(' and ', $violations)
        )));
    }

    /**
     * Neutralizes a route in place: original handler unreachable, middleware
     * exclusions discarded, guards left intact.
     */
    private function drop(Route $route): void
    {
        $action = $route->getAction();
        unset($action['controller'], $action['excluded_middleware']);
        $action['uses'] = BlockedExtensionRouteController::class . '@__invoke';
        $action['controller'] = BlockedExtensionRouteController::class . '@__invoke';

        $route->setAction($action);
    }

    private function middlewareName(mixed $middleware): string
    {
        return is_string($middleware) ? $middleware : get_debug_type($middleware);
    }
}

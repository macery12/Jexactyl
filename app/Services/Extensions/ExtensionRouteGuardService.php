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
        $groups = RouteFacade::getGroupStack();
        $inherited = $groups === [] ? [] : (end($groups)['middleware'] ?? []);
        $requiredMiddleware = array_values(array_unique([...$inherited, ...$requiredMiddleware]));
        $aliases = RouteFacade::getMiddleware();
        $middlewareGroups = RouteFacade::getMiddlewareGroups();

        $known = [];
        foreach ($collection->getRoutes() as $route) {
            $known[spl_object_id($route)] = true;
        }

        $register();

        $registrationViolations = [];
        if ($aliases !== RouteFacade::getMiddleware() || $middlewareGroups !== RouteFacade::getMiddlewareGroups()) {
            $registrationViolations[] = 'substitutes router middleware definitions';
            // Restore existing definitions before any core route can dispatch.
            foreach ($aliases as $alias => $class) {
                RouteFacade::aliasMiddleware($alias, $class);
            }
            RouteFacade::flushMiddlewareGroups();
            foreach ($middlewareGroups as $name => $middleware) {
                RouteFacade::middlewareGroup($name, $middleware);
            }
        }

        foreach ($collection->getRoutes() as $route) {
            if (!isset($known[spl_object_id($route)])) {
                $this->audit($route, $extensionId, $requiredMiddleware, $registrationViolations);
            }
        }
    }

    /**
     * @param string[] $requiredMiddleware
     */
    private function audit(Route $route, string $extensionId, array $requiredMiddleware, array $violations): void
    {
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

        // A second gate for another package is an identity violation even if
        // the route still carries the loader's correct gate. Cover class names
        // and aliases, since Laravel accepts both forms.
        $aliases = RouteFacade::getMiddleware();
        foreach ($route->middleware() as $middleware) {
            if (!is_string($middleware)) {
                continue;
            }
            [$name, $id] = array_pad(explode(':', $middleware, 2), 2, null);
            $class = $aliases[$name] ?? $name;
            foreach (['extensions.access', 'extensions.admin'] as $gate) {
                if (($name === $gate || $class === ($aliases[$gate] ?? $gate)) && $id !== $extensionId) {
                    $violations[] = 'carries an extension gate with a mismatched identity';
                }
            }
        }

        if ($violations === []) {
            return;
        }

        $this->drop($route, $requiredMiddleware);

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
    private function drop(Route $route, array $requiredMiddleware): void
    {
        $action = $route->getAction();
        unset($action['controller'], $action['excluded_middleware']);
        $action['uses'] = BlockedExtensionRouteController::class . '@__invoke';
        $action['controller'] = BlockedExtensionRouteController::class . '@__invoke';
        $action['middleware'] = array_values(array_unique([...($action['middleware'] ?? []), ...$requiredMiddleware]));

        $route->setAction($action);
        $route->flushController();
    }

    private function middlewareName(mixed $middleware): string
    {
        return is_string($middleware) ? $middleware : get_debug_type($middleware);
    }
}

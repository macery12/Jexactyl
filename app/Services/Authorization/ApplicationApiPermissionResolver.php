<?php

namespace Everest\Services\Authorization;

use Everest\Models\AdminRole;
use Illuminate\Routing\Route;
use Everest\Services\Acl\Api\AdminAcl;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;
use Everest\Http\Controllers\Api\Application\PermissionsController;
use Everest\Http\Controllers\Api\Application\Billing\BillingCycleController;

/**
 * Resolves the delegated-administrator permission declared by an Application
 * API controller action.
 *
 * Most actions declare their permission through an ApplicationApiRequest
 * parameter. The small maps below exist only for an authentication-only
 * endpoint and a legacy route whose controller action is not currently
 * present. Any other action without a declaration fails closed.
 */
class ApplicationApiPermissionResolver
{
    /**
     * Legacy API-key resources keyed by the module portion of an AdminRole
     * permission. Nested resources that share a role module are handled by the
     * route-aware overrides in scopeFor().
     *
     * @var array<string, string>
     */
    private const KEY_RESOURCES = [
        'servers' => AdminAcl::RESOURCE_SERVERS,
        'nodes' => AdminAcl::RESOURCE_NODES,
        'users' => AdminAcl::RESOURCE_USERS,
        'nests' => AdminAcl::RESOURCE_NESTS,
        'eggs' => AdminAcl::RESOURCE_EGGS,
        'databases' => AdminAcl::RESOURCE_DATABASE_HOSTS,
    ];

    /**
     * This endpoint only returns the authenticated administrator's own
     * effective role permissions. It does not expose another subject.
     *
     * @var list<string>
     */
    private const AUTHENTICATION_ONLY_ACTIONS = [
        PermissionsController::class . '@__invoke',
    ];

    /**
     * @var array<string, string>
     */
    private const ACTION_PERMISSIONS = [
        BillingCycleController::class . '@multiplierRanges' => AdminRole::BILLING_READ,
    ];

    /**
     * Return null only for an explicitly authentication-only action.
     *
     * @throws \LogicException when the action has no explicit declaration
     */
    public function permissionFor(Route $route): ?string
    {
        $action = $this->actionName($route);

        if (in_array($action, self::AUTHENTICATION_ONLY_ACTIONS, true)) {
            return null;
        }

        if (isset(self::ACTION_PERMISSIONS[$action])) {
            return self::ACTION_PERMISSIONS[$action];
        }

        [$controller, $method] = $this->splitAction($action);
        if (!class_exists($controller) || !method_exists($controller, $method)) {
            throw new \LogicException('Application API action has no permission declaration.');
        }

        $requestClasses = [];
        foreach ((new \ReflectionMethod($controller, $method))->getParameters() as $parameter) {
            $type = $parameter->getType();
            if (!$type instanceof \ReflectionNamedType || $type->isBuiltin()) {
                continue;
            }

            $class = $type->getName();
            if (is_a($class, ApplicationApiRequest::class, true)) {
                $requestClasses[] = $class;
            }
        }

        if (count($requestClasses) !== 1) {
            throw new \LogicException('Application API action must declare exactly one permission request.');
        }

        if (!method_exists($requestClasses[0], 'permission')) {
            throw new \LogicException('Application API request has no permission declaration.');
        }

        try {
            $request = (new \ReflectionClass($requestClasses[0]))->newInstanceWithoutConstructor();
            $permission = (new \ReflectionMethod($requestClasses[0], 'permission'))->invoke($request);
        } catch (\Throwable $exception) {
            throw new \LogicException('Application API request permission declaration could not be resolved.', previous: $exception);
        }
        if (!is_string($permission) || $permission === '') {
            throw new \LogicException('Application API action declared an invalid permission.');
        }

        return $permission;
    }

    /**
     * @return list<string>
     */
    public function authenticationOnlyActions(): array
    {
        return self::AUTHENTICATION_ONLY_ACTIONS;
    }

    /**
     * Resolve the legacy API-key resource and read/write action for a route.
     * Modules outside the nine-resource ACL vocabulary remain role-only.
     *
     * @return array{resource: string, action: int}|null
     */
    public function scopeFor(Route $route, ?string $permission): ?array
    {
        if ($permission === null || !str_contains($permission, '.')) {
            return null;
        }

        [$module] = explode('.', $permission, 2);
        $uri = trim($route->uri(), '/');

        if (preg_match('#^api/application/nodes/\{[^}]+}/allocations(?:/|$)#', $uri)) {
            $resource = AdminAcl::RESOURCE_ALLOCATIONS;
        } elseif (preg_match('#^api/application/servers/\{[^}]+}/databases(?:/|$)#', $uri)) {
            $resource = AdminAcl::RESOURCE_SERVER_DATABASES;
        } else {
            $resource = self::KEY_RESOURCES[$module] ?? null;
        }

        if ($resource === null) {
            return null;
        }

        return [
            'resource' => $resource,
            'action' => array_intersect(['GET', 'HEAD'], $route->methods()) !== []
                ? AdminAcl::READ
                : AdminAcl::WRITE,
        ];
    }

    private function actionName(Route $route): string
    {
        $action = ltrim($route->getActionName(), '\\');
        if (!str_contains($action, '@') && class_exists($action) && method_exists($action, '__invoke')) {
            return $action . '@__invoke';
        }

        return $action;
    }

    /**
     * @return array{string, string}
     */
    private function splitAction(string $action): array
    {
        if (!str_contains($action, '@')) {
            throw new \LogicException('Application API action has no permission declaration.');
        }

        return explode('@', $action, 2);
    }
}

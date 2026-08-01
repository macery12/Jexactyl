<?php

namespace Everest\Services\Acl\Api;

use Everest\Models\ApiKey;
use Laravel\Sanctum\TransientToken;

class AdminAcl
{
    /**
     * Resource permission columns in the api_keys table begin
     * with this identifier.
     */
    public const COLUMN_IDENTIFIER = 'r_';

    /**
     * The different types of permissions available for API keys. This
     * implements a read/write/none permissions scheme for all endpoints.
     */
    public const NONE = 0;
    public const READ = 1;
    public const WRITE = 2;

    /**
     * Resources that are available on the API and can contain a permissions
     * set for each key. These are stored in the database as r_{resource}.
     */
    public const RESOURCE_SERVERS = 'servers';
    public const RESOURCE_NODES = 'nodes';
    public const RESOURCE_ALLOCATIONS = 'allocations';
    public const RESOURCE_USERS = 'users';
    public const RESOURCE_LOCATIONS = 'locations';
    public const RESOURCE_NESTS = 'nests';
    public const RESOURCE_EGGS = 'eggs';
    public const RESOURCE_DATABASE_HOSTS = 'database_hosts';
    public const RESOURCE_SERVER_DATABASES = 'server_databases';

    /**
     * Determine whether the current access token permits an operation.
     *
     * Session-authenticated requests do not carry an ApiKey and continue to be
     * governed by the administrator's role. Application keys created before ACL
     * enforcement are explicitly marked as legacy in the database and retain
     * their previous role-only behaviour.
     */
    public static function keyPermits(mixed $token, ?string $resource, int $action = self::READ): bool
    {
        if ($resource === null) {
            return true;
        }

        if ($token instanceof TransientToken) {
            return true;
        }

        if (!$token instanceof ApiKey) {
            return false;
        }

        if (
            $token->key_type !== ApiKey::TYPE_APPLICATION
            || !in_array($resource, self::getResourceList(), true)
            || !in_array($action, [self::READ, self::WRITE], true)
        ) {
            return false;
        }

        if (!$token->acl_enforced) {
            return true;
        }

        return self::check($token, $resource, $action);
    }

    /**
     * Determine whether an access token may delegate the requested grants to a
     * newly created key. Scoped keys may only create equally or more narrowly
     * scoped keys; sessions and legacy application keys are unrestricted here.
     *
     * @param array<string, int> $permissions
     */
    public static function canDelegate(mixed $token, array $permissions): bool
    {
        if ($token instanceof TransientToken) {
            return true;
        }

        if (!$token instanceof ApiKey || $token->key_type !== ApiKey::TYPE_APPLICATION) {
            return false;
        }

        if (!$token->acl_enforced) {
            return true;
        }

        foreach (self::getResourceList() as $resource) {
            $requested = $permissions[self::COLUMN_IDENTIFIER . $resource] ?? self::NONE;
            $available = data_get($token, self::COLUMN_IDENTIFIER . $resource, self::NONE);

            if (($requested & ~$available) !== 0) {
                return false;
            }
        }

        return true;
    }

    /**
     * Determine if an API key has permission to perform a specific read/write operation.
     */
    public static function can(int $permission, int $action = self::READ): bool
    {
        if ($permission & $action) {
            return true;
        }

        return false;
    }

    /**
     * Determine if an API Key model has permission to access a given resource
     * at a specific action level.
     */
    public static function check(ApiKey $key, string $resource, int $action = self::READ): bool
    {
        return self::can(data_get($key, self::COLUMN_IDENTIFIER . $resource, self::NONE), $action);
    }

    /**
     * Convert a stored bit mask into the stable API representation.
     */
    public static function grantName(int $permission): string
    {
        if (self::can($permission, self::WRITE)) {
            return 'write';
        }

        return self::can($permission, self::READ) ? 'read' : 'none';
    }

    /**
     * Return a list of all resource constants defined in this ACL.
     *
     * @throws \ReflectionException
     */
    public static function getResourceList(): array
    {
        $reflect = new \ReflectionClass(__CLASS__);

        return collect($reflect->getConstants())->filter(function ($value, $key) {
            return substr($key, 0, 9) === 'RESOURCE_';
        })->values()->toArray();
    }
}

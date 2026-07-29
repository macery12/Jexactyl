<?php

namespace Everest\Transformers\Api;

use Everest\Models\User;
use Illuminate\Http\Request;
use Webmozart\Assert\Assert;
use Everest\Models\AdminRole;
use League\Fractal\Resource\Item;
use Illuminate\Container\Container;
use Everest\Services\Acl\Api\AdminAcl;
use League\Fractal\Resource\Collection;
use League\Fractal\TransformerAbstract;

/**
 * @method array transform(\Everest\Models\Model $model)
 */
abstract class Transformer extends TransformerAbstract
{
    protected static string $timezone = 'UTC';

    protected Request $request;

    /**
     * Sets the request instance onto the transformer abstract from the container. This
     * will also automatically handle dependency injection for the class implementing
     * this abstract.
     */
    public function __construct()
    {
        $this->request = Container::getInstance()->make('request');

        if (method_exists($this, 'handle')) {
            Container::getInstance()->call([$this, 'handle']);
        }
    }

    /**
     * Returns the resource name for the transformed item.
     */
    abstract public function getResourceName(): string;

    /**
     * Returns the authorized user for the request.
     */
    protected function user(): User
    {
        return $this->request->user();
    }

    /**
     * Maps each API ACL resource to the AdminRole read-permission that governs it.
     * Sub-resources without a first-class admin module defer to their nearest owning
     * module's read permission: allocations and locations are administered under
     * Nodes, and server databases under the Databases (database-hosts) module.
     */
    protected const INCLUDE_PERMISSIONS = [
        AdminAcl::RESOURCE_SERVERS => AdminRole::SERVERS_READ,
        AdminAcl::RESOURCE_NODES => AdminRole::NODES_READ,
        AdminAcl::RESOURCE_ALLOCATIONS => AdminRole::NODES_READ,
        AdminAcl::RESOURCE_LOCATIONS => AdminRole::NODES_READ,
        AdminAcl::RESOURCE_USERS => AdminRole::USERS_READ,
        AdminAcl::RESOURCE_NESTS => AdminRole::NESTS_READ,
        AdminAcl::RESOURCE_EGGS => AdminRole::EGGS_READ,
        AdminAcl::RESOURCE_DATABASE_HOSTS => AdminRole::DATABASES_READ,
        AdminAcl::RESOURCE_SERVER_DATABASES => AdminRole::DATABASES_READ,
    ];

    /**
     * Determines if the user making this request is authorized to expand the given
     * related resource via `?include=`. Root admins may expand anything; a scoped
     * admin must hold the AdminRole read-permission that governs the resource. An
     * unauthenticated request, an unmapped resource, or a role missing the required
     * permission all fail closed and yield a null include rather than leaking data.
     */
    protected function authorize(string $resource): bool
    {
        $user = $this->request->user();
        if (!$user instanceof User) {
            return false;
        }

        $required = self::INCLUDE_PERMISSIONS[$resource] ?? null;
        if ($required === null) {
            return false;
        }

        $roleAllows = $user->root_admin
            || (
                $user->admin_role_id !== null
                && in_array($required, AdminRole::find($user->admin_role_id)->permissions ?? [], true)
            );

        return $roleAllows
            && AdminAcl::keyPermits($user->currentAccessToken(), $resource, AdminAcl::READ);
    }

    /**
     * @param callable|TransformerAbstract $transformer
     */
    protected function item($data, $transformer, ?string $resourceKey = null): Item
    {
        if (!$transformer instanceof \Closure) {
            self::assertSameNamespace($transformer);
        }

        $item = parent::item($data, $transformer, $resourceKey);

        if (!$item->getResourceKey() && method_exists($transformer, 'getResourceName')) {
            $item->setResourceKey($transformer->getResourceName());
        }

        return $item;
    }

    /**
     * @param callable|TransformerAbstract $transformer
     */
    protected function collection($data, $transformer, ?string $resourceKey = null): Collection
    {
        if (!$transformer instanceof \Closure) {
            self::assertSameNamespace($transformer);
        }

        $collection = parent::collection($data, $transformer, $resourceKey);

        if (!$collection->getResourceKey() && method_exists($transformer, 'getResourceName')) {
            $collection->setResourceKey($transformer->getResourceName());
        }

        return $collection;
    }

    /**
     * Sets the default timezone to use for transformed responses. Pass a null value
     * to return back to the default timezone (UTC).
     */
    public static function setTimezone(?string $tz = null)
    {
        static::$timezone = $tz ?? 'UTC';
    }

    /**
     * Asserts that the given transformer is the same base namespace as the class that
     * implements this abstract transformer class. This prevents a client or application
     * transformer from unintentionally transforming a resource using an unexpected type.
     *
     * @param callable|TransformerAbstract $transformer
     */
    protected static function assertSameNamespace($transformer)
    {
        $transformerClass = is_object($transformer) ? get_class($transformer) : $transformer;

        Assert::string($transformerClass);
        Assert::subclassOf($transformerClass, TransformerAbstract::class);

        $namespace = substr($transformerClass, 0, strlen(class_basename($transformerClass)) * -1);
        $expected = substr(static::class, 0, strlen(class_basename(static::class)) * -1);

        Assert::same($namespace, $expected, 'Cannot invoke a new transformer (%s) that is not in the same namespace (%s).');
    }
}

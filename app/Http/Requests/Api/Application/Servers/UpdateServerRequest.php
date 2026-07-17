<?php

namespace Everest\Http\Requests\Api\Application\Servers;

use Everest\Models\Server;
use Illuminate\Support\Arr;
use Everest\Models\AdminRole;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

class UpdateServerRequest extends ApplicationApiRequest
{
    public function rules(): array
    {
        $rules = Server::getRules();

        // The limits object is optional on update (billing-only edits omit it), but the
        // model rules mark each child `required`, which fires even when `limits` itself
        // is absent — so scope the requirement to requests that actually send limits.
        $withLimits = fn (array $rule): array => array_map(
            fn ($piece) => $piece === 'required' ? 'required_with:limits' : $piece,
            $rule,
        );

        return [
            'external_id' => $rules['external_id'],
            'name' => $rules['name'],
            'description' => array_merge(['nullable'], $rules['description']),
            'owner_id' => $rules['owner_id'],

            'limits' => 'sometimes|array',
            'limits.memory' => $withLimits($rules['memory']),
            'limits.swap' => $withLimits($rules['swap']),
            'limits.disk' => $withLimits($rules['disk']),
            'limits.io' => $withLimits($rules['io']),
            'limits.threads' => $rules['threads'],
            'limits.cpu' => $withLimits($rules['cpu']),
            'limits.oom_killer' => 'sometimes|boolean',

            'feature_limits' => 'required|array',
            'feature_limits.allocations' => $rules['allocation_limit'],
            'feature_limits.backups' => $rules['backup_limit'],
            'feature_limits.databases' => $rules['database_limit'],
            'feature_limits.subusers' => $rules['subuser_limit'],
            'feature_limits.subdomains' => $rules['subdomain_limit'],

            'renewal_date' => $rules['renewal_date'],
            'billing_product_id' => $rules['billing_product_id'],
            'billing_days' => $rules['billing_days'],

            'allocation_id' => 'bail|exists:allocations,id',
            'add_allocations' => 'bail|array',
            'add_allocations.*' => 'integer',
            'remove_allocations' => 'bail|array',
            'remove_allocations.*' => 'integer',
        ];
    }

    /**
     * @param string|null $key
     * @param string|array|null $default
     *
     * @return mixed
     */
    public function validated($key = null, $default = null)
    {
        $data = parent::validated();
        $response = [
            'external_id' => array_get($data, 'external_id'),
            'name' => array_get($data, 'name'),
            'description' => array_get($data, 'description'),
            'owner_id' => array_get($data, 'owner_id'),

            'allocation_limit' => array_get($data, 'feature_limits.allocations'),
            'backup_limit' => array_get($data, 'feature_limits.backups'),
            'database_limit' => array_get($data, 'feature_limits.databases'),
            'subuser_limit' => array_get($data, 'feature_limits.subusers'),

            'allocation_id' => array_get($data, 'allocation_id'),
            'add_allocations' => array_get($data, 'add_allocations'),
            'remove_allocations' => array_get($data, 'remove_allocations'),
        ];

        if (Arr::has($data, 'feature_limits.subdomains')) {
            $response['subdomain_limit'] = array_get($data, 'feature_limits.subdomains');
        }

        // Same present-only treatment for build limits: BuildModificationService merges
        // whatever keys exist (Arr::only), so emitting them unconditionally would write
        // nulls over a server's build on any request that omitted the limits object.
        foreach (['memory', 'swap', 'disk', 'io', 'threads', 'cpu', 'oom_killer'] as $limitKey) {
            if (Arr::has($data, 'limits.' . $limitKey)) {
                $response[$limitKey] = array_get($data, 'limits.' . $limitKey);
            }
        }

        // Only surface the billing keys the request actually sent. DetailsModificationService
        // keys off array_key_exists to leave a server's plan alone on a non-billing update,
        // so emitting these unconditionally (as null) would wipe billing on every save.
        foreach (['renewal_date', 'billing_product_id', 'billing_days'] as $billingKey) {
            if (Arr::has($data, $billingKey)) {
                $response[$billingKey] = array_get($data, $billingKey);
            }
        }

        return is_null($key) ? $response : Arr::get($response, $key, $default);
    }

    public function permission(): string
    {
        return AdminRole::SERVERS_UPDATE;
    }
}

<?php

namespace Everest\Transformers\Api\Client;

use Everest\Models\Egg;
use Everest\Models\Server;
use Everest\Models\Allocation;
use Everest\Models\Permission;
use League\Fractal\Resource\Item;
use Everest\Models\ExtensionConfig;
use Illuminate\Container\Container;
use League\Fractal\Resource\Collection;
use Everest\Transformers\Api\Transformer;
use League\Fractal\Resource\NullResource;
use Everest\Services\Servers\StartupCommandService;

class ServerTransformer extends Transformer
{
    protected array $defaultIncludes = ['allocations', 'variables'];

    protected array $availableIncludes = ['egg', 'subusers'];

    public function getResourceName(): string
    {
        return Server::RESOURCE_NAME;
    }

    /**
     * Transform a server model into a representation that can be returned
     * to a client.
     */
    public function transform(Server $server): array
    {
        /** @var StartupCommandService $service */
        $service = Container::getInstance()->make(StartupCommandService::class);

        $user = $this->request->user();

        // Check if server supports modpacks by checking for required environment variables
        $modpacksSupported = false;
        if ($server->relationLoaded('variables')) {
            $hasProjectId = false;
            $hasVersionId = false;

            foreach ($server->variables as $variable) {
                if ($variable->env_variable === 'PROJECT_ID') {
                    $hasProjectId = true;
                }
                if ($variable->env_variable === 'VERSION_ID') {
                    $hasVersionId = true;
                }
                // Early exit if both found
                if ($hasProjectId && $hasVersionId) {
                    break;
                }
            }

            $modpacksSupported = $hasProjectId && $hasVersionId;
        }

        // Check if any extensions are enabled for this server
        $extensionsEnabled = config('modules.extensions.enabled', false)
            && !empty(ExtensionConfig::getEnabledForServer($server));

        return [
            'server_owner' => $user->id === $server->owner_id,
            'identifier' => $server->uuidShort,
            'internal_id' => $server->id,
            'group_ids' => $server->groups->pluck('id')->toArray(),
            'uuid' => $server->uuid,
            'name' => $server->name,
            'node' => $server->node->name,
            'node_id' => $server->node_id,
            'is_node_under_maintenance' => $server->node->isUnderMaintenance(),
            'is_node_supercharged' => $server->node->isSupercharged(),
            'sftp_details' => [
                'ip' => $server->node->fqdn,
                'port' => $server->node->public_port_sftp,
            ],
            'description' => $server->description,
            'limits' => [
                'memory' => $server->memory,
                'swap' => $server->swap,
                'disk' => $server->disk,
                'io' => $server->io,
                'cpu' => $server->cpu,
                'threads' => $server->threads,
                'oom_killer' => $server->oom_killer,
            ],
            'invocation' => (!is_null($server->startup) && $server->startup !== '') ? $server->startup : $server->egg->startup,
            'docker_image' => $server->image,
            'egg_features' => $server->egg->inherit_features,
            'egg_id' => $server->egg_id,
            'modpacks_supported' => $modpacksSupported,
            'extensions_enabled' => $extensionsEnabled,
            'billing_product_id' => $server->billing_product_id,
            'billing_days' => $server->billing_days,
            'feature_limits' => [
                'databases' => $server->database_limit,
                'allocations' => $server->allocation_limit,
                'backups' => $server->backup_limit,
                'subusers' => $server->subuser_limit,
                'subdomains' => $server->subdomain_limit ?? $server->product?->subdomain_limit,
            ],
            'status' => $server->status,
            'renewal_date' => $server->renewal_date,
            'deletion_scheduled_at' => $server->deletion_scheduled_at,
            'deletion_canceled_at' => $server->deletion_canceled_at,
            'deletion_scheduled_by' => $server->deletion_scheduled_by,
            'is_deletion_scheduled' => $server->isDeletionScheduled(),
            'is_transferring' => !is_null($server->transfer),
        ];
    }

    /**
     * Returns the allocations associated with this server.
     */
    public function includeAllocations(Server $server): Collection
    {
        $transformer = new AllocationTransformer();

        $user = $this->request->user();
        // While we include this permission, we do need to actually handle it slightly different here
        // for the purpose of keeping things functionally working. If the user doesn't have read permissions
        // for the allocations we'll only return the primary server allocation, and any notes associated
        // with it will be hidden.
        //
        // This allows us to avoid too much permission regression, without also hiding information that
        // is generally needed for the frontend to make sense when browsing or searching results.
        if (!$user->can(Permission::ACTION_ALLOCATION_READ, $server)) {
            $primary = clone $server->allocation;
            $primary->notes = null;

            return $this->collection([$primary], $transformer);
        }

        return $this->collection($server->allocations, $transformer);
    }

    public function includeVariables(Server $server): Collection|NullResource
    {
        if (!$this->request->user()->can(Permission::ACTION_STARTUP_READ, $server)) {
            return $this->null();
        }

        return $this->collection($server->variables->where('user_viewable', true), new EggVariableTransformer());
    }

    /**
     * Returns the egg associated with this server.
     */
    public function includeEgg(Server $server): Item
    {
        return $this->item($server->egg, new EggTransformer());
    }

    /**
     * Returns the subusers associated with this server.
     */
    public function includeSubusers(Server $server): Collection|NullResource
    {
        if (!$this->request->user()->can(Permission::ACTION_USER_READ, $server)) {
            return $this->null();
        }

        return $this->collection($server->subusers, new SubuserTransformer());
    }
}

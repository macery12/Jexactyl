<?php

namespace Everest\Services\Servers;

use Everest\Models\Egg;
use Everest\Models\User;
use Everest\Models\Server;
use Everest\Models\Allocation;
use Everest\Models\EggVariable;
use Everest\Models\ServerPreset;
use Everest\Exceptions\DisplayException;

class ServerPresetCreationService
{
    /**
     * ServerPresetCreationService constructor.
     */
    public function __construct(private ServerCreationService $creationService)
    {
    }

    /**
     * Create a server via a server preset, referencing
     * ServerCreationService as the main service.
     *
     * @throws \Throwable
     * @throws DisplayException
     */
    public function handle(User $user, array $data): Server
    {
        $preset = ServerPreset::findOrFail($data['preset_id']);
        $egg = Egg::findOrFail($preset->egg_id ?? 1);
        $allocation = Allocation::where('node_id', $data['node_id'])->where('server_id', null)->first();
        $environment = $this->getEnvironmentWithDefaults($egg);

        // A node with nothing free used to fatal on ->id below.
        if (is_null($allocation)) {
            throw new DisplayException('The selected node has no free allocations available.');
        }

        $data = [
            'owner_id' => $user->id,
            'name' => $preset->name . ' server',
            'node_id' => (int) $data['node_id'],
            'cpu' => $preset->cpu,
            'memory' => $preset->memory,
            'disk' => $preset->disk,
            'swap' => $preset->swap,
            'io' => $preset->io,
            // Was `$preset->node_id`, a column server_presets does not have — so
            // this silently resolved to null and every preset built on nest 1.
            'nest_id' => $preset->nest_id ?? $egg->nest_id,
            'egg_id' => $preset->egg_id ?? 1,
            'allocation_id' => $allocation->id,
            'database_limit' => $preset->databases,
            'backup_limit' => $preset->backups,
            'allocation_limit' => $preset->allocations,
            'subuser_limit' => $preset->subusers,
            'image' => current($egg->docker_images),
            'startup' => $egg->startup,
            'environment' => $environment,
        ];

        $server = $this->creationService->handle($data);

        return $server;
    }

    /**
     * Get all environment variables with their default values for an egg.
     */
    private function getEnvironmentWithDefaults(Egg $egg): array
    {
        $variables = [];
        $defaults = EggVariable::where('egg_id', $egg->id)->get();

        foreach ($defaults as $variable) {
            $variables[$variable->env_variable] = $variable->default_value;
        }

        return $variables;
    }
}

<?php

namespace Everest\Http\Controllers\Api\Client;

use Everest\Models\ServerGroup;
use Illuminate\Http\JsonResponse;
use Everest\Http\Requests\Api\Client\ClientApiRequest;
use Everest\Transformers\Api\Client\ServerGroupTransformer;
use Everest\Http\Requests\Api\Client\ServerGroups\StoreServerGroupRequest;
use Everest\Http\Requests\Api\Client\ServerGroups\UpdateServerGroupRequest;
use Everest\Http\Requests\Api\Client\ServerGroups\AssignServerToGroupRequest;
use Everest\Http\Requests\Api\Client\ServerGroups\RemoveServerFromGroupRequest;

class ServerGroupController extends ClientApiController
{
    /**
     * Returns all the API keys that exist for the given client.
     */
    public function index(ClientApiRequest $request): array
    {
        return $this->fractal->collection($request->user()->serverGroups)
            ->transformWith(ServerGroupTransformer::class)
            ->toArray();
    }

    /**
     * Create a new server group and store in the database.
     */
    public function store(StoreServerGroupRequest $request): array
    {
        $data = $request->validated();

        $group = ServerGroup::create([
            'user_id' => $request->user()->id,
            'name' => $data['name'],
            'color' => $data['color'] ?? null,
        ]);

        return $this->fractal->item($group)
            ->transformWith(ServerGroupTransformer::class)
            ->toArray();
    }

    /**
     * Add a server to the selected group.
     */
    public function add(AssignServerToGroupRequest $request, int $id): JsonResponse
    {
        $data = $request->validated();
        $group = $request->user()->serverGroups()->findOrFail($id);
        $server = $request->user()->servers()->where('uuid', $data['server'])->firstOrFail();

        $server->groups()->syncWithoutDetaching([$group->id]);

        return new JsonResponse([], JsonResponse::HTTP_NO_CONTENT);
    }

    /**
     * Remove a server from the selected group.
     */
    public function remove(RemoveServerFromGroupRequest $request, int $id): JsonResponse
    {
        $data = $request->validated();
        // Verify group ownership - findOrFail ensures the group belongs to this user
        $request->user()->serverGroups()->findOrFail($id);
        $server = $request->user()->servers()->where('uuid', $data['server'])->firstOrFail();

        $server->groups()->detach($id);

        return new JsonResponse([], JsonResponse::HTTP_NO_CONTENT);
    }

    /**
     * Update a selected server group.
     */
    public function update(UpdateServerGroupRequest $request, int $id): JsonResponse
    {
        $data = $request->validated();
        $group = $request->user()->serverGroups()->findOrFail($id);

        $group->update([
            'name' => array_key_exists('name', $data) ? $data['name'] : $group->name,
            'color' => array_key_exists('color', $data) ? $data['color'] : $group->color,
        ]);

        return new JsonResponse([], JsonResponse::HTTP_NO_CONTENT);
    }

    /**
     * Delete a selected server group.
     */
    public function delete(ClientApiRequest $request, int $id): JsonResponse
    {
        $group = $request->user()->serverGroups()->findOrFail($id);

        $group->delete();

        return new JsonResponse([], JsonResponse::HTTP_NO_CONTENT);
    }
}

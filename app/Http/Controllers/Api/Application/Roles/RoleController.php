<?php

namespace Everest\Http\Controllers\Api\Application\Roles;

use Everest\Models\User;
use Everest\Models\ApiKey;
use Everest\Models\AdminRole;
use Illuminate\Http\Response;
use Illuminate\Http\JsonResponse;
use Spatie\QueryBuilder\QueryBuilder;
use Everest\Services\Authorization\AdminAuthorizer;
use Everest\Services\Authorization\AdminCapabilityRegistry;
use Everest\Exceptions\Http\QueryValueOutOfRangeHttpException;
use Everest\Transformers\Api\Application\AdminRoleTransformer;
use Everest\Http\Requests\Api\Application\Roles\GetRoleRequest;
use Everest\Http\Requests\Api\Application\Roles\GetRolesRequest;
use Everest\Http\Requests\Api\Application\Roles\StoreRoleRequest;
use Symfony\Component\HttpKernel\Exception\ConflictHttpException;
use Everest\Http\Requests\Api\Application\Roles\DeleteRoleRequest;
use Everest\Http\Requests\Api\Application\Roles\UpdateRoleRequest;
use Everest\Http\Controllers\Api\Application\ApplicationApiController;
use Everest\Services\Authorization\ApplicationApiAccessProfileService;

class RoleController extends ApplicationApiController
{
    /**
     * RoleController constructor.
     */
    public function __construct(
        private AdminAuthorizer $authorizer,
        private AdminCapabilityRegistry $capabilities,
        private ApplicationApiAccessProfileService $apiProfiles,
    ) {
        parent::__construct();
    }

    /**
     * Returns an array of all roles.
     */
    public function index(GetRolesRequest $request): array
    {
        $perPage = (int) $request->query('per_page', '20');
        if ($perPage < 1 || $perPage > 100) {
            throw new QueryValueOutOfRangeHttpException('per_page', 1, 100);
        }

        $roles = QueryBuilder::for(AdminRole::query())
            ->allowedFilters(...['id', 'name'])
            ->allowedSorts(...['id', 'name'])
            ->paginate($perPage);

        return $this->fractal->collection($roles)
            ->transformWith(AdminRoleTransformer::class)
            ->toArray();
    }

    /**
     * Returns a single role.
     */
    public function view(GetRoleRequest $request, AdminRole $role): array
    {
        return $this->fractal->item($role)
            ->transformWith(AdminRoleTransformer::class)
            ->toArray();
    }

    /**
     * Returns all of the available admin permissions assignable to users.
     */
    public function permissions(GetRoleRequest $request): array
    {
        return [
            'object' => 'role_permissions',
            'attributes' => [
                'permissions' => AdminRole::permissions(),
            ],
        ];
    }

    /**
     * Creates a new role.
     */
    public function store(StoreRoleRequest $request): JsonResponse
    {
        $data = $request->validated();
        $data['permissions'] = $this->capabilities->normalizeMany($data['permissions'] ?? []);
        $this->assertWithinPrivilegeCeiling($request, null, $data['permissions']);

        $data = array_merge($data, [
            'sort_id' => 99,
        ]);
        $role = AdminRole::query()->create($data);

        return $this->fractal->item($role)
            ->transformWith(AdminRoleTransformer::class)
            ->respond(JsonResponse::HTTP_CREATED);
    }

    /**
     * Updates a role.
     */
    public function update(UpdateRoleRequest $request, AdminRole $role): array
    {
        $this->assertProfileIsEditable($role);

        $validated = $request->validated();
        if (array_key_exists('permissions', $validated)) {
            $validated['permissions'] = $this->capabilities->normalizeMany($validated['permissions']);
            $this->assertWithinPrivilegeCeiling($request, $role, (array) $validated['permissions']);
        } else {
            $this->assertWithinPrivilegeCeiling($request, $role, null);
        }

        $role->update($validated);

        return $this->fractal->item($role)
            ->transformWith(AdminRoleTransformer::class)
            ->toArray();
    }

    /**
     * Updates the assigned permissions to a role.
     */
    public function updatePermissions(UpdateRoleRequest $request, AdminRole $role): array
    {
        $this->assertProfileIsEditable($role);

        $permissions = $this->capabilities->normalizeMany($request->validated('permissions', []));
        $this->assertWithinPrivilegeCeiling($request, $role, $permissions);

        $role->update(['permissions' => $permissions]);

        return $this->fractal->item($role)
            ->transformWith(AdminRoleTransformer::class)
            ->toArray();
    }

    /**
     * Enforce a self-privilege ceiling on role edits. A non-root admin holding
     * `roles.update` must not be able to (a) edit the role assigned to them — the
     * direct self-escalation vector — or (b) grant any permission they do not
     * themselves already hold, on any role. Root admins are unrestricted.
     *
     * @param array<int, string>|null $requestedPermissions the permission set being
     *                                                      assigned, or null when the
     *                                                      request does not touch permissions
     */
    private function assertWithinPrivilegeCeiling(
        StoreRoleRequest $request,
        ?AdminRole $role,
        ?array $requestedPermissions,
    ): void {
        $actor = $request->user();
        if ($this->authorizer->isInteractiveOwner($actor)) {
            return;
        }

        $token = $actor->currentAccessToken();
        $principalProfileId = $token instanceof ApiKey ? $token->admin_role_id : $actor->admin_role_id;
        if ($role && $principalProfileId !== null && (int) $principalProfileId === (int) $role->id) {
            abort(403, 'You cannot modify the role assigned to your own account.');
        }

        if ($requestedPermissions === null) {
            return;
        }

        $actorPermissions = $this->apiProfiles->principalCapabilities($actor);
        $exceeding = array_diff($requestedPermissions, $actorPermissions);
        if (!empty($exceeding)) {
            abort(403, 'You cannot grant permissions that your own role does not hold.');
        }
    }

    /**
     * Deletes a role.
     *
     * @throws \Exception
     */
    public function delete(DeleteRoleRequest $request, AdminRole $role): Response
    {
        $this->assertProfileIsEditable($role);

        if (User::query()->where('admin_role_id', $role->id)->exists()) {
            throw new ConflictHttpException('This Access Profile is assigned to users. Reassign those users before deleting it.');
        }
        if (ApiKey::query()->where('admin_role_id', $role->id)->exists()) {
            throw new ConflictHttpException('This Access Profile is assigned to Application API keys. Reassign or delete those keys before deleting it.');
        }

        $role->delete();

        return $this->returnNoContent();
    }

    private function assertProfileIsEditable(AdminRole $profile): void
    {
        if ($profile->isProtected() || $profile->isOwner()) {
            abort(403, 'The built-in Owner Access Profile cannot be modified or deleted.');
        }
    }
}

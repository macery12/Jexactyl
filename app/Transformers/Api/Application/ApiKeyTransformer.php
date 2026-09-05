<?php

namespace Everest\Transformers\Api\Application;

use Everest\Models\ApiKey;
use Everest\Services\Acl\Api\AdminAcl;
use Everest\Transformers\Api\Transformer;

class ApiKeyTransformer extends Transformer
{
    public function getResourceName(): string
    {
        return ApiKey::RESOURCE_NAME;
    }

    /**
     * Transform this model into a representation that can be consumed by a client.
     */
    public function transform(ApiKey $model): array
    {
        $permissions = [];
        foreach (AdminAcl::getResourceList() as $resource) {
            $permissions[$resource] = AdminAcl::grantName($model->getAttribute(AdminAcl::COLUMN_IDENTIFIER . $resource));
        }

        $profile = $model->accessProfile;
        $creator = $model->user;

        return [
            'id' => $model->id,
            'identifier' => $model->identifier,
            'description' => $model->memo,
            'allowed_ips' => $model->allowed_ips,
            'created_at' => $model->created_at->toIso8601String(),
            'last_used_at' => $model->last_used_at ? $model->last_used_at : null,
            'expires_at' => $model->expires_at?->toIso8601String(),
            'access_profile_id' => $model->admin_role_id,
            'access_profile' => $profile ? [
                'id' => $profile->id,
                'name' => $profile->name,
                'color' => $profile->color,
                'is_owner' => (bool) $profile->is_owner,
                'api_eligible' => (bool) $profile->api_eligible,
                'permissions' => $profile->permissions ?? [],
            ] : null,
            'creator' => [
                'id' => $creator->id,
                'username' => $creator->username,
                'email' => $creator->email,
            ],
            'legacy' => $model->admin_role_id === null,
            // Retained for rolling API clients only. Bound keys authorize solely
            // through access_profile and do not evaluate these dormant masks.
            'permissions' => $permissions,
        ];
    }
}

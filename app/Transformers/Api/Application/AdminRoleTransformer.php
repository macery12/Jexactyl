<?php

namespace Everest\Transformers\Api\Application;

use Everest\Models\AdminRole;
use Everest\Transformers\Api\Transformer;
use Everest\Services\Authorization\AdminCapabilityRegistry;

class AdminRoleTransformer extends Transformer
{
    /**
     * Return the resource name for the JSONAPI output.
     */
    public function getResourceName(): string
    {
        return AdminRole::RESOURCE_NAME;
    }

    /**
     * Transform admin role into a representation for the application API.
     */
    public function transform(AdminRole $model): array
    {
        $data = [
            'id' => $model->id,
            'name' => $model->name,
            'description' => $model->description,
            'color' => $model->color,
            'permissions' => $model->isOwner()
                ? app(AdminCapabilityRegistry::class)->all()
                : ($model->permissions ?: []),
            'is_system' => $model->isProtected(),
            'is_owner' => $model->isOwner(),
            'api_eligible' => (bool) $model->api_eligible,
        ];

        // Assignment counts are only present when the caller eager-loaded them
        // (the roles index/view do; the API access-profile picker does not), so
        // they stay absent rather than reporting a misleading zero.
        if ($model->users_count !== null) {
            $data['assigned_users_count'] = (int) $model->users_count;
        }
        if ($model->application_keys_count !== null) {
            $data['assigned_api_keys_count'] = (int) $model->application_keys_count;
        }

        return $data;
    }
}

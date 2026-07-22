<?php

namespace Everest\Transformers\Api\Client;

use Everest\Models\UserSession;
use Everest\Transformers\Api\Transformer;

class UserSessionTransformer extends Transformer
{
    public function getResourceName(): string
    {
        return 'user_session';
    }

    /**
     * @param UserSession $model
     */
    public function transform($model): array
    {
        return [
            'id' => $model->id,
            'device_name' => $model->device_name ?: 'Unknown device',
            'device_label' => $model->device_label,
            'ip_address' => $model->ip_address,
            'location' => $model->location,
            'user_agent' => $model->user_agent,
            'created_at' => optional($model->created_at)->toIso8601String(),
            'last_activity_at' => optional($model->last_activity_at)->toIso8601String(),
            'revoked_at' => optional($model->revoked_at)->toIso8601String(),
            'is_current' => $this->request->hasSession() && $this->request->session()->getId() === $model->session_id,
        ];
    }
}

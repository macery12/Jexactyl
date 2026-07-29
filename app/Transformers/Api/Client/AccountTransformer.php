<?php

namespace Everest\Transformers\Api\Client;

use Everest\Models\User;
use Everest\Transformers\Api\Transformer;

class AccountTransformer extends Transformer
{
    /**
     * Return the resource name for the JSONAPI output.
     */
    public function getResourceName(): string
    {
        return 'user';
    }

    /**
     * Return basic information about the currently logged-in user.
     */
    public function transform(User $model): array
    {
        return [
            'id' => $model->id,
            'admin' => $model->isOwner(),
            'username' => $model->username,
            'email' => $model->email,
            'language' => $model->language,
            'email_verified' => $model->hasVerifiedEmail(),
            'email_verified_at' => $model->email_verified_at,
            'discord_linked' => !empty($model->external_id),
        ];
    }
}

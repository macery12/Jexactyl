<?php

namespace Everest\Http\Requests\Api\Client\Extensions\DiscordSrvHelper;

use Everest\Models\Permission;
use Everest\Http\Requests\Api\Client\ClientApiRequest;

class DiscordSrvHelperOwnerRequest extends ClientApiRequest
{
    public function permission(): string
    {
        return Permission::ACTION_EXTENSION_MANAGE;
    }

    public function authorize(): bool
    {
        $server = $this->route()->parameter('server');
        $user = $this->user();

        if (!$server instanceof \Everest\Models\Server) {
            return false;
        }

        if (!$user->isOwner() && $user->id !== $server->owner_id) {
            return false;
        }

        return parent::authorize();
    }

    public function rules(): array
    {
        return [];
    }
}

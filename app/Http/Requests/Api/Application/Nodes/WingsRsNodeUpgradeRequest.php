<?php

namespace Everest\Http\Requests\Api\Application\Nodes;

use Everest\Models\ApiKey;
use Everest\Models\AdminRole;
use Everest\Services\Authorization\AdminAuthorizer;
use Everest\Http\Requests\Api\Application\ApplicationApiRequest;

/**
 * Installing a daemon executable is host-administrator-equivalent authority,
 * not ordinary delegated node configuration access.
 */
class WingsRsNodeUpgradeRequest extends ApplicationApiRequest
{
    public function permission(): string
    {
        // Retain an explicit declaration for the fail-closed Application API
        // permission inventory. authorize() applies the stricter root boundary.
        return AdminRole::NODES_UPDATE;
    }

    public function authorize(): bool
    {
        $user = $this->user();

        if ($user->currentAccessToken() instanceof ApiKey) {
            return false;
        }

        return app(AdminAuthorizer::class)->isInteractiveOwner($user);
    }
}

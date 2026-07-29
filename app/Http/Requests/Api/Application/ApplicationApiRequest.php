<?php

namespace Everest\Http\Requests\Api\Application;

use Everest\Models\User;
use Everest\Models\ApiKey;
use Everest\Http\Requests\Api\ApiRequest;
use Everest\Services\Authorization\AdminAuthorizer;
use Everest\Services\Authorization\ApplicationApiAccessProfileService;

abstract class ApplicationApiRequest extends ApiRequest
{
    /**
     * Authorize users based on their Admin Role (if exists)
     * to allow admins to visit specific permissable endpoints.
     */
    public function authorize(): bool
    {
        $user = ($this->getUserResolver())();
        if (!$user instanceof User || !$user->isActive() || !method_exists($this, 'permission')) {
            return false;
        }

        $token = $user->currentAccessToken();
        if ($token instanceof ApiKey) {
            return $token->key_type === ApiKey::TYPE_APPLICATION
                && app(ApplicationApiAccessProfileService::class)->allows($token, $this->permission());
        }

        return app(AdminAuthorizer::class)->hasCapability($user, $this->permission());
    }

    /**
     * Return only the fields that we are interested in from the request.
     * This will include empty fields as a null value.
     */
    public function normalize(?array $only = null): array
    {
        return $this->only($only ?? array_keys($this->rules()));
    }
}

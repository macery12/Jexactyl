<?php

namespace Everest\Services\Api;

use Everest\Models\User;
use Everest\Models\ApiKey;
use Everest\Models\AdminRole;
use Illuminate\Support\Facades\DB;
use Everest\Services\Acl\Api\AdminAcl;
use Everest\Exceptions\DisplayException;
use Illuminate\Contracts\Encryption\Encrypter;
use Everest\Contracts\Repository\ApiKeyRepositoryInterface;
use Everest\Services\Authorization\AdminCapabilityRegistry;

class KeyCreationService
{
    private int $keyType = ApiKey::TYPE_NONE;

    /**
     * ApiKeyService constructor.
     */
    public function __construct(private ApiKeyRepositoryInterface $repository, private Encrypter $encrypter)
    {
    }

    /**
     * Set the type of key that should be created. By default an orphaned key will be
     * created. These keys cannot be used for anything, and will not render in the UI.
     */
    public function setKeyType(int $type): self
    {
        $this->keyType = $type;

        return $this;
    }

    /**
     * Create a new API key for the Panel using the permissions passed in the data request.
     * This will automatically generate an identifier and an encrypted token that are
     * stored in the database.
     *
     * @throws \Everest\Exceptions\Model\DataValidationException
     */
    public function handle(array $data, array $permissions = []): ApiKey
    {
        return DB::transaction(function () use ($data, $permissions): ApiKey {
            if (isset($data['user_id'])) {
                /** @var User $owner */
                $owner = User::query()
                    ->whereKey($data['user_id'])
                    ->lockForUpdate()
                    ->firstOrFail();
                if (!$owner->isActive()) {
                    throw new DisplayException('This account cannot create API keys in its current state.');
                }
            }

            $attributes = array_merge($data, [
                'key_type' => $this->keyType,
                'identifier' => ApiKey::generateTokenIdentifier($this->keyType),
                'token' => $this->encrypter->encrypt(str_random(ApiKey::KEY_LENGTH)),
            ]);

            if ($this->keyType === ApiKey::TYPE_APPLICATION) {
                if (empty($data['admin_role_id'])) {
                    throw new DisplayException('Application API keys require an API-eligible access profile.');
                }

                $profile = AdminRole::query()->find($data['admin_role_id']);
                if (!$profile || !app(AdminCapabilityRegistry::class)->isApiEligible($profile)) {
                    throw new DisplayException('Application API keys require a non-Owner, API-eligible access profile.');
                }

                $scopedPermissions = [];
                foreach (AdminAcl::getResourceList() as $resource) {
                    $column = AdminAcl::COLUMN_IDENTIFIER . $resource;
                    $scopedPermissions[$column] = $permissions[$column] ?? AdminAcl::NONE;
                }

                $attributes = array_merge($attributes, $scopedPermissions, ['acl_enforced' => true]);
            }

            return $this->repository->create($attributes, true, true);
        });
    }
}

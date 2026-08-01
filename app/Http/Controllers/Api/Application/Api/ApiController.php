<?php

namespace Everest\Http\Controllers\Api\Application\Api;

use Everest\Models\ApiKey;
use Everest\Facades\Activity;
use Everest\Models\AdminRole;
use Illuminate\Http\Response;
use Illuminate\Http\JsonResponse;
use Spatie\QueryBuilder\QueryBuilder;
use Everest\Services\Api\KeyCreationService;
use Everest\Transformers\Api\Application\ApiKeyTransformer;
use Everest\Exceptions\Http\QueryValueOutOfRangeHttpException;
use Everest\Transformers\Api\Application\AdminRoleTransformer;
use Everest\Http\Controllers\Api\Application\ApplicationApiController;
use Everest\Services\Authorization\ApplicationApiAccessProfileService;
use Everest\Http\Requests\Api\Application\Api\GetApplicationApiKeysRequest;
use Everest\Http\Requests\Api\Application\Api\StoreApplicationApiKeyRequest;
use Everest\Http\Requests\Api\Application\Api\DeleteApplicationApiKeyRequest;
use Everest\Http\Requests\Api\Application\Api\GetDelegableAccessProfilesRequest;

class ApiController extends ApplicationApiController
{
    /**
     * ApiController constructor.
     */
    public function __construct(
        private KeyCreationService $keyCreationService,
        private ApplicationApiAccessProfileService $profiles,
    ) {
        parent::__construct();
    }

    /**
     * Return all the Admin API keys currently registered on the Panel.
     */
    public function index(GetApplicationApiKeysRequest $request): array
    {
        $perPage = (int) $request->query('per_page', '20');
        if ($perPage < 1 || $perPage > 100) {
            throw new QueryValueOutOfRangeHttpException('per_page', 1, 100);
        }

        $apiKeys = QueryBuilder::for(ApiKey::query()->with(['accessProfile', 'user']))
            ->where('key_type', 2)
            ->allowedFilters(...['id', 'identifier', 'last_used_at'])
            ->allowedSorts(...['id', 'identifier', 'last_used_at'])
            ->paginate($perPage);

        return $this->fractal->collection($apiKeys)
            ->transformWith(ApiKeyTransformer::class)
            ->toArray();
    }

    /**
     * Return only API-eligible profiles whose canonical capabilities are no
     * broader than the requesting human or service principal.
     */
    public function accessProfiles(GetDelegableAccessProfilesRequest $request): array
    {
        return $this->fractal->collection($this->profiles->delegableProfiles($request->user()))
            ->transformWith(AdminRoleTransformer::class)
            ->toArray();
    }

    /**
     * Create a new Admin API key for the Panel.
     */
    public function store(StoreApplicationApiKeyRequest $request): JsonResponse
    {
        $permissions = $request->keyPermissions();
        $profileId = $request->accessProfileId();
        if ($profileId !== null) {
            $profile = AdminRole::query()->findOrFail($profileId);
            $this->profiles->assertCanDelegate($request->user(), $profile);
        } else {
            $profile = $this->profiles->createLegacyProfile($request->user(), $permissions);
        }

        $apiKey = $this->keyCreationService->setKeyType(ApiKey::TYPE_APPLICATION)->handle([
            'memo' => $request->input('memo'),
            'user_id' => $request->user()->id,
            'admin_role_id' => $profile->id,
            'allowed_ips' => $request->input('allowed_ips', []),
            'expires_at' => $request->input('expires_at'),
        ], $permissions);

        Activity::event('admin:api-keys:create')
            ->property('api-key', $apiKey)
            ->property('access-profile-id', $profile->id)
            ->description('A new Application API key was created')
            ->log();

        $token = '' . $apiKey->identifier . '' . decrypt($apiKey->token);

        return response()->json(['token' => $token]);
    }

    /**
     * Delete the requested API key.
     */
    public function delete(DeleteApplicationApiKeyRequest $request, ApiKey $key): Response
    {
        if ($key->key_type !== ApiKey::TYPE_APPLICATION) {
            return response('', Response::HTTP_NOT_FOUND);
        }

        Activity::event('admin:api-keys:delete')
            ->property('api-key', $key)
            ->description('An Application API key was deleted')
            ->log();

        ApiKey::where('id', $key->id)->delete();

        return $this->returnNoContent();
    }
}

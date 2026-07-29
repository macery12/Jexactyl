<?php

namespace Everest\Http\Controllers\Api\Application\Api;

use Everest\Models\ApiKey;
use Everest\Facades\Activity;
use Illuminate\Http\Response;
use Illuminate\Http\JsonResponse;
use Spatie\QueryBuilder\QueryBuilder;
use Everest\Services\Acl\Api\AdminAcl;
use Everest\Services\Api\KeyCreationService;
use Everest\Transformers\Api\Application\ApiKeyTransformer;
use Everest\Exceptions\Http\QueryValueOutOfRangeHttpException;
use Symfony\Component\HttpKernel\Exception\AccessDeniedHttpException;
use Everest\Http\Controllers\Api\Application\ApplicationApiController;
use Everest\Http\Requests\Api\Application\Api\GetApplicationApiKeysRequest;
use Everest\Http\Requests\Api\Application\Api\StoreApplicationApiKeyRequest;
use Everest\Http\Requests\Api\Application\Api\DeleteApplicationApiKeyRequest;

class ApiController extends ApplicationApiController
{
    /**
     * ApiController constructor.
     */
    public function __construct(
        private KeyCreationService $keyCreationService,
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

        $apiKeys = QueryBuilder::for(ApiKey::query())
            ->where('key_type', 2)
            ->allowedFilters(...['id', 'identifier', 'last_used_at'])
            ->allowedSorts(...['id', 'identifier', 'last_used_at'])
            ->paginate($perPage);

        return $this->fractal->collection($apiKeys)
            ->transformWith(ApiKeyTransformer::class)
            ->toArray();
    }

    /**
     * Create a new Admin API key for the Panel.
     */
    public function store(StoreApplicationApiKeyRequest $request): JsonResponse
    {
        $permissions = $request->keyPermissions();
        if (!AdminAcl::canDelegate($request->user()->currentAccessToken(), $permissions)) {
            throw new AccessDeniedHttpException('An API key cannot create a key with broader resource permissions than its own.');
        }

        $apiKey = $this->keyCreationService->setKeyType(ApiKey::TYPE_APPLICATION)->handle([
            'memo' => $request->input('memo'),
            'user_id' => $request->user()->id,
        ], $permissions);

        Activity::event('admin:api-keys:create')
            ->property('api-key', $apiKey)
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

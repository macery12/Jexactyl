<?php

namespace Everest\Http\Controllers\Api\Client\Servers;

use Everest\Models\Server;
use Everest\Facades\Activity;
use Illuminate\Http\JsonResponse;
use Everest\Services\Servers\StartupCommandService;
use Everest\Repositories\Eloquent\ServerVariableRepository;
use Everest\Services\Servers\StartupVariableVersionService;
use Everest\Transformers\Api\Client\EggVariableTransformer;
use Everest\Http\Controllers\Api\Client\ClientApiController;
use Symfony\Component\HttpKernel\Exception\BadRequestHttpException;
use Everest\Http\Requests\Api\Client\Servers\Startup\GetStartupRequest;
use Everest\Http\Requests\Api\Client\Servers\Startup\UpdateStartupVariableRequest;
use Everest\Http\Requests\Api\Client\Servers\Startup\GetStartupVariableVersionsRequest;

class StartupController extends ClientApiController
{
    /**
     * StartupController constructor.
     */
    public function __construct(
        private StartupCommandService $startupCommandService,
        private StartupVariableVersionService $versionService,
        private ServerVariableRepository $repository,
    ) {
        parent::__construct();
    }

    /**
     * Returns the startup information for the server including all the variables.
     */
    public function index(GetStartupRequest $request, Server $server): array
    {
        $startup = $this->startupCommandService->handle($server);

        return $this->fractal->collection(
            $server->variables()->where('user_viewable', true)->get()
        )
            ->transformWith(EggVariableTransformer::class)
            ->addMeta([
                'startup_command' => $startup,
                // Which image is *in use*, alongside the ones on offer. Reading
                // the map alone tells you a server could run Java 8 and 19, not
                // which of them it is running — and that is the whole question
                // when a server that used to boot has stopped booting.
                'docker_image' => $server->image,
                'docker_images' => $server->egg->docker_images,
                'raw_startup_command' => $server->startup,
            ])
            ->toArray();
    }

    /**
     * Returns version options for a startup variable if supported.
     */
    public function versions(GetStartupVariableVersionsRequest $request, Server $server): JsonResponse
    {
        $envVariable = strtoupper($request->input('key', ''));
        $server->loadMissing('variables');

        $variable = $server->variables->firstWhere('env_variable', $envVariable);
        if (is_null($variable) || !$variable->user_viewable) {
            throw new BadRequestHttpException('The environment variable you are trying to view does not exist.');
        }

        $data = $this->versionService->getOptionsForVariable(
            server: $server,
            envVariable: $envVariable,
            includeSnapshots: $request->boolean('include_snapshots'),
            context: $request->input('context', []),
        );

        return new JsonResponse([
            'object' => 'startup_variable_versions',
            'attributes' => [
                'key' => $envVariable,
                'supported' => $data['supported'] ?? false,
                'provider' => $data['provider'] ?? null,
                'supports_snapshots' => $data['supports_snapshots'] ?? false,
                'include_snapshots' => $data['include_snapshots'] ?? false,
                'stale' => $data['stale'] ?? false,
                'error' => $data['error'] ?? null,
                'context' => $data['context'] ?? [],
                'options' => $data['options'] ?? [],
            ],
        ]);
    }

    /**
     * Updates a single variable for a server.
     *
     * @throws \Illuminate\Validation\ValidationException
     * @throws \Everest\Exceptions\Model\DataValidationException
     * @throws \Everest\Exceptions\Repository\RecordNotFoundException
     */
    public function update(UpdateStartupVariableRequest $request, Server $server): array
    {
        $variable = $server->variables()->where('env_variable', $request->input('key'))->first();

        if (is_null($variable) || !$variable->user_viewable) {
            throw new BadRequestHttpException('The environment variable you are trying to edit does not exist.');
        } elseif (!$variable->user_editable) {
            throw new BadRequestHttpException('The environment variable you are trying to edit is read-only.');
        }

        $original = $variable->server_value;

        // Revalidate the variable value using the egg variable specific validation rules for it.
        $this->validate($request, ['value' => $variable->rules]);

        $this->repository->updateOrCreate([
            'server_id' => $server->id,
            'variable_id' => $variable->id,
        ], [
            'variable_value' => $request->input('value') ?? '',
        ]);

        $variable = $variable->refresh();
        $variable->server_value = $request->input('value');

        $startup = $this->startupCommandService->handle($server);

        if ($variable->env_variable !== $request->input('value')) {
            Activity::event('server:startup.edit')
                ->subject($variable)
                ->property([
                    'variable' => $variable->env_variable,
                    'old' => $original,
                    'new' => $request->input('value'),
                ])
                ->log();
        }

        return $this->fractal->item($variable)
            ->transformWith(EggVariableTransformer::class)
            ->addMeta([
                'startup_command' => $startup,
                'raw_startup_command' => $server->startup,
            ])
            ->toArray();
    }
}

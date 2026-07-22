<?php

namespace Everest\Console\Commands\Extensions\Concerns;

use Everest\Models\ExtensionRepository;
use Everest\Exceptions\DisplayException;
use Everest\Services\Extensions\ExtensionRepositoryBootstrapService;

trait InteractsWithExtensionRepositories
{
    private function resolveRepository(mixed $identifier): ExtensionRepository
    {
        if ($identifier === null || trim((string) $identifier) === '') {
            return app(ExtensionRepositoryBootstrapService::class)->ensureOfficialRepository();
        }

        $identifier = trim((string) $identifier);

        $repository = ctype_digit($identifier)
            ? ExtensionRepository::query()->find((int) $identifier)
            : ExtensionRepository::query()->where('slug', $identifier)->orWhere('name', $identifier)->first();

        if ($repository) {
            return $repository;
        }

        throw new DisplayException(sprintf('No extension repository matched "%s".', $identifier));
    }
}

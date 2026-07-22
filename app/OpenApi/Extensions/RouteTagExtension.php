<?php

namespace Everest\OpenApi\Extensions;

use Illuminate\Support\Str;
use Dedoc\Scramble\Support\RouteInfo;
use Dedoc\Scramble\Support\Generator\Operation;
use Dedoc\Scramble\Extensions\OperationExtension;

class RouteTagExtension extends OperationExtension
{
    public function handle(Operation $operation, RouteInfo $routeInfo)
    {
        $uri = trim($routeInfo->route->uri, '/');
        $segments = collect(explode('/', $uri));

        if ($segments->first() === config('scramble.api_path', 'api')) {
            $segments->shift();
        }

        $tag = $segments->first() ?? '';

        if (in_array($tag, ['client', 'application']) && $segments->count() > 1) {
            $tag = $segments[1];
        }

        if ($tag === '' || $tag === null) {
            $tag = Str::of(class_basename($routeInfo->className() ?? ''))
                ->before('Controller')
                ->snake(' ')
                ->replace('_', ' ')
                ->trim()
                ->title()
                ->value() ?: 'API';
        }

        $normalizedTag = Str::of($tag)
            ->replace(['-', '_'], ' ')
            ->trim()
            ->title()
            ->value();

        $operation->setTags(array_values(array_unique([$normalizedTag, ...$operation->tags])));
    }
}

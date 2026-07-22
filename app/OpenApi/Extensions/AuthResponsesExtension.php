<?php

namespace Everest\OpenApi\Extensions;

use Illuminate\Support\Str;
use Dedoc\Scramble\Support\RouteInfo;
use Dedoc\Scramble\Support\Generator\Schema;
use Dedoc\Scramble\Support\Generator\Response;
use Everest\Http\Middleware\AdminAuthenticate;
use Dedoc\Scramble\Support\Generator\Operation;
use Dedoc\Scramble\Extensions\OperationExtension;
use Dedoc\Scramble\Support\Generator\Types as OpenApiTypes;
use Everest\Http\Middleware\RequireTwoFactorAuthentication;

class AuthResponsesExtension extends OperationExtension
{
    public function handle(Operation $operation, RouteInfo $routeInfo)
    {
        $middlewares = collect($routeInfo->route->gatherMiddleware());
        $existingCodes = collect($operation->responses ?? [])->pluck('code')->filter()->all();

        $requiresAuth = $middlewares->contains(function ($middleware) {
            if (is_string($middleware)) {
                return Str::contains($middleware, ['auth:', 'auth.', 'sanctum', 'client-api', 'application-api']);
            }

            return false;
        });

        if ($requiresAuth && !in_array(401, $existingCodes)) {
            $operation->addResponse($this->jsonMessageResponse(401, 'Unauthenticated'));
        }

        $requiresAdmin = $middlewares->contains(AdminAuthenticate::class);
        $requiresTwoFactor = $middlewares->contains(RequireTwoFactorAuthentication::class);

        if (($requiresAdmin || $requiresTwoFactor || $requiresAuth) && !in_array(403, $existingCodes)) {
            $operation->addResponse($this->jsonMessageResponse(403, 'Forbidden'));
        }
    }

    private function jsonMessageResponse(int $code, string $message): Response
    {
        $schema = Schema::fromType(
            (new OpenApiTypes\ObjectType())
                ->addProperty('message', (new OpenApiTypes\StringType())->setDescription($message))
                ->setRequired(['message'])
        );

        return Response::make($code)
            ->description($message)
            ->setContent('application/json', $schema);
    }
}

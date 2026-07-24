<?php

namespace Everest\Exceptions\Http\Auth;

use Illuminate\Http\Response;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

/**
 * Thrown when a suspended account passes credential verification. Suspension was
 * previously only enforced by middleware on the client API, which let a
 * suspended user hold a valid session and reach everything else.
 */
class AccountSuspendedException extends HttpException implements HttpExceptionInterface
{
    public function __construct(?\Throwable $previous = null)
    {
        parent::__construct(
            Response::HTTP_FORBIDDEN,
            'This account has been suspended. Please contact support if you believe this is a mistake.',
            $previous
        );
    }
}

<?php

namespace Everest\Http\Middleware\Api\Daemon;

use Illuminate\Http\Request;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Everest\Http\Requests\Api\Remote\ActivityEventRequest;

/**
 * Reject daemon activity batches before Laravel decodes their JSON payload.
 */
class RejectOversizedActivityRequest
{
    public function handle(Request $request, \Closure $next): mixed
    {
        if (
            !$request->isMethod(Request::METHOD_POST)
            || trim($request->path(), '/') !== 'api/remote/activity'
        ) {
            return $next($request);
        }

        $declaredLength = $request->headers->get('Content-Length');
        if (
            is_string($declaredLength)
            && ctype_digit($declaredLength)
            && (int) $declaredLength > ActivityEventRequest::MAX_REQUEST_BYTES
        ) {
            throw new HttpException(413, 'The daemon activity request body is too large.');
        }

        if (strlen($request->getContent()) > ActivityEventRequest::MAX_REQUEST_BYTES) {
            throw new HttpException(413, 'The daemon activity request body is too large.');
        }

        return $next($request);
    }
}

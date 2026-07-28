<?php

namespace Everest\Http\Middleware;

use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Illuminate\Http\Exceptions\PostTooLargeException;
use Everest\Http\Requests\Api\Client\Servers\Files\WriteFileWithDiffRequest;

class RejectOversizedFileDiffRequest
{
    /**
     * Reject oversized file-diff bodies before TrimStrings, JSON decoding, route
     * binding, and FormRequest construction can perform work on the payload.
     */
    public function handle(Request $request, \Closure $next): Response
    {
        if (
            !$request->isMethod('POST')
            || !$request->is('api/client/servers/*/files/write-with-diff')
        ) {
            return $next($request);
        }

        $contentLength = $request->server->get('CONTENT_LENGTH');
        if (
            is_scalar($contentLength)
            && ctype_digit((string) $contentLength)
            && (int) $contentLength > WriteFileWithDiffRequest::MAX_REQUEST_BYTES
        ) {
            throw new PostTooLargeException('The file-diff request body is too large.');
        }

        // Content-Length can be missing or untrusted. Reading the raw bytes here
        // still happens before Laravel asks the request to decode JSON input.
        if (strlen($request->getContent()) > WriteFileWithDiffRequest::MAX_REQUEST_BYTES) {
            throw new PostTooLargeException('The file-diff request body is too large.');
        }

        return $next($request);
    }
}

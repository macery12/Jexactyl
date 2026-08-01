<?php

namespace Everest\Tests\Unit\Http\Middleware;

use Everest\Tests\TestCase;
use Illuminate\Http\Request;
use Illuminate\Http\Exceptions\PostTooLargeException;
use Everest\Http\Middleware\RejectOversizedFileDiffRequest;
use Everest\Http\Requests\Api\Client\Servers\Files\WriteFileWithDiffRequest;

class RejectOversizedFileDiffRequestTest extends TestCase
{
    public function testDeclaredOversizedDiffIsRejectedBeforeTheNextMiddleware(): void
    {
        $request = Request::create(
            '/api/client/servers/server-uuid/files/write-with-diff',
            'POST',
            server: ['CONTENT_LENGTH' => (string) (WriteFileWithDiffRequest::MAX_REQUEST_BYTES + 1)],
        );

        $called = false;

        try {
            (new RejectOversizedFileDiffRequest())->handle(
                $request,
                function () use (&$called) {
                    $called = true;
                },
            );
            $this->fail('An oversized request should have been rejected.');
        } catch (PostTooLargeException $exception) {
            $this->assertSame(413, $exception->getStatusCode());
        }

        $this->assertFalse($called);
    }

    public function testOversizedBodyWithoutContentLengthIsRejected(): void
    {
        $request = Request::create(
            '/api/client/servers/server-uuid/files/write-with-diff',
            'POST',
            content: str_repeat('x', WriteFileWithDiffRequest::MAX_REQUEST_BYTES + 1),
        );

        $this->expectException(PostTooLargeException::class);

        (new RejectOversizedFileDiffRequest())->handle($request, fn () => response('ok'));
    }

    public function testOtherRoutesAreNotSubjectToTheDedicatedDiffLimit(): void
    {
        $request = Request::create(
            '/api/client/servers/server-uuid/files/write',
            'POST',
            content: str_repeat('x', WriteFileWithDiffRequest::MAX_REQUEST_BYTES + 1),
        );

        $response = (new RejectOversizedFileDiffRequest())->handle(
            $request,
            fn () => response('ok'),
        );

        $this->assertSame('ok', $response->getContent());
    }
}

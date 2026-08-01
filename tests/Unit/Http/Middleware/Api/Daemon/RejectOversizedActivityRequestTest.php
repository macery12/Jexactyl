<?php

namespace Everest\Tests\Unit\Http\Middleware\Api\Daemon;

use Everest\Http\Kernel;
use Everest\Tests\TestCase;
use Illuminate\Http\Request;
use Everest\Http\Middleware\TrimStrings;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Everest\Http\Requests\Api\Remote\ActivityEventRequest;
use Everest\Http\Middleware\Api\Daemon\RejectOversizedActivityRequest;

class RejectOversizedActivityRequestTest extends TestCase
{
    public function testMiddlewareRunsBeforeGlobalStringInputTransformation(): void
    {
        $property = new \ReflectionProperty(Kernel::class, 'middleware');
        $middleware = $property->getValue(app(Kernel::class));

        $activityLimit = array_search(RejectOversizedActivityRequest::class, $middleware, true);
        $inputTransformation = array_search(TrimStrings::class, $middleware, true);

        $this->assertIsInt($activityLimit);
        $this->assertIsInt($inputTransformation);
        $this->assertLessThan($inputTransformation, $activityLimit);
    }

    public function testDeclaredOversizedBodyIsRejectedBeforeReadingInput(): void
    {
        $request = Request::create('/api/remote/activity', 'POST');
        $request->headers->set('Content-Length', (string) (ActivityEventRequest::MAX_REQUEST_BYTES + 1));

        $nextCalled = false;

        try {
            (new RejectOversizedActivityRequest())->handle($request, function () use (&$nextCalled) {
                $nextCalled = true;
            });
            $this->fail('Expected an oversized request exception.');
        } catch (HttpException $exception) {
            $this->assertSame(413, $exception->getStatusCode());
            $this->assertFalse($nextCalled);
        }
    }

    public function testActualOversizedBodyIsRejectedWhenLengthHeaderIsMissing(): void
    {
        $request = Request::create(
            '/api/remote/activity',
            'POST',
            [],
            [],
            [],
            [],
            str_repeat('x', ActivityEventRequest::MAX_REQUEST_BYTES + 1)
        );
        $request->headers->remove('Content-Length');

        $this->expectException(HttpException::class);
        (new RejectOversizedActivityRequest())->handle($request, fn () => null);
    }

    public function testBoundarySizedBodyContinues(): void
    {
        $request = Request::create(
            '/api/remote/activity',
            'POST',
            [],
            [],
            [],
            [],
            str_repeat('x', ActivityEventRequest::MAX_REQUEST_BYTES)
        );

        $response = (new RejectOversizedActivityRequest())->handle($request, fn () => 'next');

        $this->assertSame('next', $response);
    }

    public function testOtherPathsPassThroughWithoutInspectingTheirBodySize(): void
    {
        $request = Request::create(
            '/api/remote/backups/example',
            'POST',
            [],
            [],
            [],
            [],
            str_repeat('x', ActivityEventRequest::MAX_REQUEST_BYTES + 1)
        );

        $response = (new RejectOversizedActivityRequest())->handle($request, fn () => 'next');

        $this->assertSame('next', $response);
    }

    public function testOtherMethodsOnActivityPathPassThrough(): void
    {
        $request = Request::create(
            '/api/remote/activity',
            'GET',
            [],
            [],
            [],
            [],
            str_repeat('x', ActivityEventRequest::MAX_REQUEST_BYTES + 1)
        );

        $response = (new RejectOversizedActivityRequest())->handle($request, fn () => 'next');

        $this->assertSame('next', $response);
    }
}

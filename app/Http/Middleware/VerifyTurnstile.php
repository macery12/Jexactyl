<?php

namespace Everest\Http\Middleware;

use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Everest\Events\Auth\FailedCaptcha;
use Everest\Services\Auth\TurnstileService;
use Illuminate\Contracts\Events\Dispatcher;
use Symfony\Component\HttpKernel\Exception\HttpException;

class VerifyTurnstile
{
    /**
     * VerifyTurnstile constructor.
     */
    public function __construct(
        private Dispatcher $dispatcher,
        private TurnstileService $turnstileService,
    ) {
    }

    /**
     * Handle an incoming request.
     */
    public function handle(Request $request, \Closure $next): mixed
    {
        // If Turnstile is not enabled, skip verification
        if (!$this->turnstileService->isEnabled()) {
            return $next($request);
        }

        $token = $request->input('cf-turnstile-response');

        if (!$token) {
            return response()->json(['error' => 'Missing captcha token'], 400);
        }

        // Verify the token with the user's IP
        $verified = $this->turnstileService->verify($token, $request->ip());

        if ($verified) {
            return $next($request);
        }

        // Dispatch failed captcha event
        $this->dispatcher->dispatch(
            new FailedCaptcha($request->ip(), null)
        );

        throw new HttpException(Response::HTTP_BAD_REQUEST, 'Failed to validate captcha data.');
    }
}

<?php

namespace Everest\Http\Middleware;

use Illuminate\Http\Request;
use Everest\Services\Email\EmailVerificationGate;

class EnsureVerifiedCanInteractArea
{
    public function __construct(private EmailVerificationGate $gate)
    {
    }

    public function handle(Request $request, \Closure $next, string $area)
    {
        if ($this->gate->canInteractArea($request->user(), $area)) {
            return $next($request);
        }

        return $this->gate->denyResponse($request);
    }
}

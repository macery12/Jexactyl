<?php

namespace Everest\Http\Middleware;

use Illuminate\Http\Request;
use Everest\Services\Email\EmailVerificationGate;

class EnsureVerifiedCanViewArea
{
    public function __construct(private EmailVerificationGate $gate)
    {
    }

    public function handle(Request $request, \Closure $next, string $area)
    {
        if ($this->gate->canViewArea($request->user(), $area)) {
            return $next($request);
        }

        return $this->gate->denyResponse($request);
    }
}

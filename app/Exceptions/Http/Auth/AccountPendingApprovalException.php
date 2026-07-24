<?php

namespace Everest\Exceptions\Http\Auth;

use Illuminate\Http\Response;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Symfony\Component\HttpKernel\Exception\HttpExceptionInterface;

/**
 * Thrown when jGuard is holding an account for approval and something tried to
 * issue it a session. Carries its own class name into the JSONAPI `code` field
 * so the SPA can render the dedicated "awaiting approval" screen instead of a
 * generic red error box.
 */
class AccountPendingApprovalException extends HttpException implements HttpExceptionInterface
{
    public const DEFAULT_MESSAGE = 'Your account is awaiting approval by an administrator.';

    public function __construct(?string $message = null, ?\Throwable $previous = null)
    {
        parent::__construct(Response::HTTP_FORBIDDEN, $message ?: self::DEFAULT_MESSAGE, $previous);
    }

    /**
     * Resolve the admin-configured message, falling back to the default when the
     * setting was left empty.
     */
    public static function withConfiguredMessage(): self
    {
        $configured = config('modules.auth.jguard.pending_message');

        return new self(is_string($configured) && trim($configured) !== '' ? trim($configured) : null);
    }
}

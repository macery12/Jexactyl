<?php

namespace Everest\Services\AI\Tools;

/**
 * Marker placed on an internal sub-request's attribute bag to identify it as
 * agent traffic.
 *
 * An object rather than a string on purpose. `Request::$attributes` is a
 * server-side bag that neither `createFromGlobals()` nor `createFromBase()`
 * ever populates from the wire, so there is no header, query parameter, or
 * body field an external caller could set to land a value in it. Comparing by
 * object identity means that even if something could write to the bag, it
 * could not produce *this instance*.
 *
 * The rate limiter uses it to give agent steps their own budget instead of
 * consuming the human's — see RouteServiceProvider::configureRateLimiting().
 */
final class InternalToolCall
{
    public const ATTRIBUTE = 'everest.ai.internal_tool_call';

    private static ?self $instance = null;

    private function __construct()
    {
    }

    public static function marker(): self
    {
        return self::$instance ??= new self();
    }

    public static function matches(mixed $value): bool
    {
        return self::$instance !== null && $value === self::$instance;
    }
}

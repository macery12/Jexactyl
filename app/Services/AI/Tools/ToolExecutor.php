<?php

namespace Everest\Services\AI\Tools;

use Everest\Models\Setting;
use Illuminate\Support\Str;
use Illuminate\Http\Request;
use Everest\Facades\Activity;
use Illuminate\Routing\Route;
use Illuminate\Support\Facades\Log;
use Illuminate\Database\DatabaseManager;
use Symfony\Component\HttpFoundation\Response;
use Illuminate\Contracts\Foundation\Application;
use Everest\Exceptions\Service\AI\AIServiceException;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Illuminate\Support\Facades\Request as RequestFacade;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Everest\Services\Activity\ActivityLogTargetableService;
use Illuminate\Contracts\Http\Kernel as HttpKernelContract;

/**
 * Runs a tool by dispatching an internal sub-request through the panel's real
 * HTTP pipeline.
 *
 * The core security decision of the agent: every tool call traverses the exact
 * middleware a browser request does — `AuthenticateServerAccess`,
 * `ResourceBelongsToServer`, the endpoint's FormRequest `permission()` gate and
 * its validation — so there is no second authorization path to drift.
 *
 * Six constraints, each a real failure:
 *
 * 1. **Send no cookies.** Re-sending already-decrypted ones makes EncryptCookies
 *    fail, nulling the session cookie and regenerating the id on the *shared*
 *    store, which logs the user out mid-stream. Auth propagates anyway: the
 *    guard has already cached the user.
 * 2. **Clear the matched route's cached controller.** Routes are process-wide and
 *    `Route::getController()` memoises onto them, so Fractal's accumulating
 *    `parseIncludes()` would leak one tool's `?include=` into later calls.
 * 3. **Refuse streamed and binary responses.** Reading their bodies means sending
 *    them, straight into the live SSE stream.
 * 4. **Send `Accept: application/json`**, or a ValidationException becomes a 302
 *    and an HttpException renders HTML instead of a structured envelope.
 * 5. **Never dispatch inside a transaction.** The exception handler rolls back to
 *    level 0 when it renders, taking the caller's transaction with it.
 * 6. **Bound how long it may block.** Inherited node timeouts run to a quarter of
 *    an hour, against a turn budget of three minutes.
 */
class ToolExecutor
{
    public function __construct(
        private Application $app,
        private DatabaseManager $db,
    ) {
    }

    public function execute(
        ToolInvocation $invocation,
        ?int $maxSeconds = null,
    ): ToolResult {
        // The exception handler calls rollBack(0) when it renders, so a failure
        // inside the sub-request would silently discard the caller's work.
        if ($this->db->transactionLevel() > 0) {
            return ToolResult::internalError('Tool calls may not run inside a database transaction.');
        }

        $parentRequest = $this->app->make('request');
        $parentRoute = $this->app->resolved(Route::class) ? $this->app->make(Route::class) : null;
        $obLevel = ob_get_level();

        $target = $this->app->make(ActivityLogTargetableService::class);
        $snapshot = [$target->actor(), $target->subject(), $target->apiKeyId(), $target->isAdmin()];

        $timeouts = $this->clampNodeTimeouts($maxSeconds);
        $sub = $this->buildSubRequest($invocation, $parentRequest);
        $matched = null;
        $alarm = $this->startDeadlineAlarm($maxSeconds);

        try {
            Activity::reset();

            $response = $this->app->make(HttpKernelContract::class)->handle($sub);
            $matched = $sub->route();

            return $this->toResult($response);
        } catch (AIServiceException $e) {
            if ($e->getMessage() === 'The internal tool deadline elapsed.') {
                return ToolResult::error('time_limit', 'The tool call exceeded the remaining turn time.');
            }

            report($e);

            return ToolResult::internalError('The tool call could not be completed.');
        } catch (\Throwable $e) {
            // Kernel::handle already renders most throwables; anything reaching
            // here is unexpected, so report it and give the model something
            // terse that leaks nothing.
            report($e);

            return ToolResult::internalError('The tool call could not be completed.');
        } finally {
            $this->restoreDeadlineAlarm($alarm);

            if ($matched instanceof Route) {
                $matched->controller = null;
            }

            config($timeouts);

            Activity::reset();
            $this->restoreLogTarget($target, $snapshot);

            // Re-binding `request` fires the container rebound hooks, which is
            // what restores the auth guards, the URL generator, and the user
            // resolver — none of those need handling individually.
            $this->app->instance('request', $parentRequest);
            RequestFacade::clearResolvedInstance();

            if ($parentRoute !== null) {
                $this->app->instance(Route::class, $parentRoute);
            } else {
                $this->app->forgetInstance(Route::class);
            }

            while (ob_get_level() > $obLevel) {
                ob_end_flush();
            }
        }
    }

    /**
     * Hold the node timeouts down for one tool call, returning what they were
     * so the caller can restore them.
     *
     * Lowered, never raised — an operator who tightened `GUZZLE_TIMEOUT` meant
     * it. The point is that the fifteen-minute archive timeout cannot be
     * inherited by a model that will simply sit there; an overrun becomes a
     * failed tool call the model can route around. Config rather than a
     * parameter because the value must reach a repository several layers into
     * the sub-request.
     *
     * @return array<string, int> the previous values, shaped for `config()`
     */
    protected function clampNodeTimeouts(?int $remainingSeconds = null): array
    {
        $ceiling = max(5, (int) Setting::get(
            'settings::modules:ai:agent:max_tool_seconds',
            config('modules.ai.agent.max_tool_seconds', 90)
        ));
        if ($remainingSeconds !== null) {
            $ceiling = max(1, min($ceiling, $remainingSeconds));
        }

        $previous = [
            'everest.guzzle.timeout' => (int) config('everest.guzzle.timeout'),
            'everest.guzzle.archive_timeout' => (int) config('everest.guzzle.archive_timeout'),
        ];

        config([
            'everest.guzzle.timeout' => min($previous['everest.guzzle.timeout'], $ceiling),
            'everest.guzzle.archive_timeout' => min($previous['everest.guzzle.archive_timeout'], $ceiling),
        ]);

        return $previous;
    }

    /**
     * Bound local controller and database work as well as node HTTP calls.
     * PCNTL alarms interrupt the synchronous kernel dispatch; deployments
     * without PCNTL retain their configured PHP execution limit because the
     * stream no longer disables it.
     *
     * @return array{handler: mixed, async: bool}|null
     */
    protected function startDeadlineAlarm(?int $seconds): ?array
    {
        if (
            $seconds === null
            || $seconds < 1
            || !function_exists('pcntl_alarm')
            || !function_exists('pcntl_signal_get_handler')
            || !function_exists('pcntl_async_signals')
        ) {
            return null;
        }

        $state = [
            'handler' => pcntl_signal_get_handler(SIGALRM),
            'async' => pcntl_async_signals(true),
        ];

        pcntl_signal(SIGALRM, static function (): void {
            throw new AIServiceException('The internal tool deadline elapsed.');
        });
        pcntl_alarm($seconds);

        return $state;
    }

    /** @param array{handler: mixed, async: bool}|null $state */
    protected function restoreDeadlineAlarm(?array $state): void
    {
        if ($state === null) {
            return;
        }

        pcntl_alarm(0);
        pcntl_signal(SIGALRM, $state['handler']);
        pcntl_async_signals($state['async']);
    }

    /**
     * Build the sub-request. Carries no `Cookie`, `Authorization`, `Referer` or
     * `Origin` header: without a session cookie the stateful path is skipped, so
     * CSRF and session handling never run, while the guard's cached user keeps
     * the identity and token instance identical. Fails closed — a cold cache
     * 401s rather than escalating.
     */
    protected function buildSubRequest(ToolInvocation $invocation, Request $parent): Request
    {
        $isRead = $invocation->isRead();

        $sub = Request::create(
            // Absolute so the URL generator stays correct after the rebind —
            // signed node URLs for downloads depend on it.
            uri: $parent->getSchemeAndHttpHost() . $invocation->fullUri(),
            method: strtoupper($invocation->method),
            parameters: $isRead ? $invocation->query : [],
            cookies: [],
            files: [],
            server: ['REMOTE_ADDR' => $parent->ip()],
            content: $isRead ? null : json_encode($invocation->body ?: new \stdClass()),
        );

        // Mandatory: it is what makes the exception handler emit the JSON
        // envelope instead of a redirect or an HTML error page.
        $sub->headers->set('Accept', 'application/json');
        $sub->headers->set('X-Requested-With', 'XMLHttpRequest');

        if ($invocation->idempotencyKey !== null) {
            $sub->headers->set('Idempotency-Key', $invocation->idempotencyKey);
        }

        if (!$isRead) {
            $sub->headers->set('Content-Type', 'application/json');
        }

        foreach (['Cookie', 'Authorization', 'Referer', 'Origin', 'X-XSRF-TOKEN', 'X-CSRF-TOKEN'] as $header) {
            $sub->headers->remove($header);
        }

        $sub->attributes->set(InternalToolCall::ATTRIBUTE, InternalToolCall::marker());
        $sub->setUserResolver($parent->getUserResolver());

        return $sub;
    }

    /**
     * `setIsAdmin()` is write-only-true, so the flag can only be restored by
     * resetting first and re-applying.
     */
    protected function restoreLogTarget(ActivityLogTargetableService $target, array $snapshot): void
    {
        [$actor, $subject, $apiKeyId, $isAdmin] = $snapshot;

        $target->reset();

        if ($actor !== null) {
            $target->setActor($actor);
        }
        if ($subject !== null) {
            $target->setSubject($subject);
        }
        $target->setApiKeyId($apiKeyId);
        if ($isAdmin) {
            $target->setIsAdmin();
        }
    }

    protected function toResult(Response $response): ToolResult
    {
        // getContent() returns false on these; the only way to read the body is
        // to send it, which would write into the caller's live SSE stream.
        if ($response instanceof StreamedResponse || $response instanceof BinaryFileResponse) {
            return ToolResult::error(
                'unsupported_response',
                'This endpoint streams its response and cannot be called as a tool.'
            );
        }

        $status = $response->getStatusCode();
        $body = (string) $response->getContent();
        $decoded = json_decode($body, true);
        $isJson = json_last_error() === JSON_ERROR_NONE;

        if ($status >= 200 && $status < 300) {
            // Do not cap here. A JSON response must remain decoded until its
            // tool-specific shaper and privacy redactor have run; the runner
            // applies the final serialized-byte cap after both.
            return ToolResult::ok($isJson ? $decoded : $body);
        }

        return $this->toError($status, $isJson ? $decoded : null);
    }

    protected function toError(int $status, ?array $decoded): ToolResult
    {
        $errors = is_array($decoded['errors'] ?? null) ? $decoded['errors'] : [];
        $first = is_array($errors[0] ?? null) ? $errors[0] : [];

        // 422 carries one entry per field with the offending rule — genuinely
        // good retry signal, so it is surfaced rather than flattened.
        $fields = null;
        if ($status === 422 && $errors !== []) {
            $fields = [];
            foreach ($errors as $error) {
                if (!is_array($error)) {
                    continue;
                }
                $field = $error['meta']['source_field'] ?? null;
                $fields[$field ?: 'request'] = (string) ($error['detail'] ?? 'Invalid value.');
            }
        }

        return ToolResult::error(
            code: $this->errorCode($status, $first),
            detail: $this->errorDetail($status, $first),
            status: $status,
            // 409 means "start the server first"; 422 means "fix your
            // arguments"; 429/5xx mean "back off". 403/404 mean stop.
            retryable: in_array($status, [409, 422, 429, 500, 502, 503, 504], true),
            fields: $fields,
        );
    }

    protected function errorCode(int $status, array $first): string
    {
        $code = $first['code'] ?? null;

        // The panel renders every exception with `class_basename($e)` as its
        // code, so passing one through puts PHP class names like
        // `DaemonConnectionException` into the model's context and onto the
        // user's screen. Only an already-stable machine code is trusted; a
        // class name is StudlyCase and fails this deliberately.
        if (is_string($code) && preg_match('/^[a-z][a-z0-9_]*$/', $code)) {
            return $code;
        }

        return match (true) {
            $status === 403 => 'forbidden',
            $status === 404 => 'not_found',
            $status === 409 => 'conflict',
            $status === 422 => 'validation_failed',
            $status === 429 => 'rate_limited',
            // The node, not the panel, is what failed. Worth distinguishing:
            // the model should wait and retry rather than rephrase.
            in_array($status, [502, 503, 504], true) => 'node_unavailable',
            default => 'http_error',
        };
    }

    /**
     * Build the message the model sees.
     *
     * Only the detail string is ever read, never the envelope:
     * `convertExceptionToArray()` injects `source.file`, `source.line` and a
     * full `meta.trace` under APP_DEBUG, none of which may reach the model and
     * thence the user's screen over SSE.
     *
     * 5xx details are dropped in every mode. Debug-on they carry SQL, table
     * names and paths; debug-off, controllers that wrap failures leak the same
     * through the same door. None of it is actionable anyway — a 5xx means wait
     * and retry, and the exception is already in the log. Node-raised 5xx use
     * the table below for the same reason.
     */
    protected function errorDetail(int $status, array $first): string
    {
        $detail = $status < 500 ? ($first['detail'] ?? null) : null;

        if (is_string($detail) && ($cleaned = $this->unwrapDaemonMessage($detail)) !== '') {
            return Str::limit($cleaned, 500);
        }

        return match (true) {
            $status === 403 => 'You do not have permission to do that on this server.',
            $status === 404 => 'That does not exist. List the parent directory to see what is actually there rather than guessing another path.',
            $status === 409 => 'The server is not in a state that allows this right now.',
            $status === 429 => 'Too many requests. Wait a moment before trying again.',
            in_array($status, [502, 503, 504], true) => 'The machine running this server is not responding right now.',
            $status >= 500 => 'The panel could not complete that request. It has been logged. Wait a moment and try again, or tell the user it failed.',
            default => 'The request failed with status ' . $status . '.',
        };
    }

    /**
     * Unwrap the daemon's error envelope. `DaemonConnectionException` wraps the
     * node's prose and appends a request id, turning "no such directory" into
     * "An error occurred on the remote host: … (request id: <nil>)" — noise the
     * model reasons past, at a token cost on every later step of the turn.
     */
    protected function unwrapDaemonMessage(string $detail): string
    {
        if (preg_match('/^An error occurred on the remote host: (.+?)\.?\s*\(request id:.*$/is', $detail, $matches)) {
            $detail = $matches[1];
        }

        // The 5xx variant instead carries a trailing "(code: N) (request_id: X)".
        $detail = preg_replace('/\s*\((?:code|request[ _]id):[^)]*\)/i', '', $detail) ?? $detail;

        return trim($detail);
    }

    /**
     * Whether a request is agent traffic. Used by the rate limiters to give
     * tool steps their own budget instead of consuming the human's.
     */
    public static function isInternal(Request $request): bool
    {
        return InternalToolCall::matches($request->attributes->get(InternalToolCall::ATTRIBUTE));
    }
}

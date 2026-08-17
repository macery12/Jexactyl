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
 * This is the core security decision of the agent. Rather than re-implementing
 * authorization for the agent — which would drift from the browser's the first
 * time a permission changed — every tool call traverses the exact middleware
 * stack a browser request does: `AuthenticateServerAccess` (404s a server the
 * user cannot reach), `ResourceBelongsToServer` (404s cross-server resources),
 * the endpoint's own FormRequest `permission()` gate, and its validation rules.
 * There is deliberately no second code path to get wrong.
 *
 * Six things this has to get right, each a real failure rather than a
 * theoretical one:
 *
 * 1. **Send no cookies.** They have already been decrypted in place on the
 *    parent request; re-sending them makes EncryptCookies fail to decrypt,
 *    which nulls the session cookie, which regenerates the id on the *shared*
 *    session store, which makes UpdateUserSessionActivity find no tracking
 *    record and log the user out mid-stream. Auth propagates without them
 *    because the guard has already resolved and cached the user.
 * 2. **Clear the matched route's cached controller.** Routes are shared across
 *    the process and `Route::getController()` memoises onto them; the API
 *    controllers snapshot the request and call Fractal's `parseIncludes()`,
 *    which *accumulates* — so one tool's `?include=` would leak into every
 *    later call on that route.
 * 3. **Refuse streamed and binary responses.** Their bodies can only be read
 *    by sending them, which would echo straight into the live SSE stream.
 * 4. **Send `Accept: application/json`.** Without it a ValidationException
 *    becomes a 302 with flashed errors and an HttpException renders an HTML
 *    view, instead of the structured envelope the model can act on.
 * 5. **Never dispatch inside a transaction.** The exception handler rolls back
 *    to level 0 when it renders, which would take the caller's transaction
 *    with it.
 * 6. **Bound how long it may block.** A sub-request inherits the panel's own
 *    node timeouts, and some of those are a quarter of an hour — fine for a
 *    person who clicked "compress" and can see a progress bar, useless inside a
 *    turn whose whole wall-clock budget is three minutes.
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
     * Hold the node timeouts down for the duration of one tool call, returning
     * what they were so the caller can put them back.
     *
     * Lowered rather than replaced: an operator who has already tightened
     * `GUZZLE_TIMEOUT` meant it, and this has no business relaxing it. What it
     * does mean is that the archive timeout — fifteen minutes, and correct for a
     * person watching a progress bar — cannot be inherited by a model that will
     * simply sit there. A tool that overruns comes back as a failed tool call the
     * model can report or route around, which is strictly better than a turn that
     * looks identical to a crash.
     *
     * Config rather than a parameter because the value has to reach a repository
     * several layers down the sub-request, and threading a timeout through the
     * HTTP kernel is not a thing that can be done.
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
     * Build the sub-request.
     *
     * Deliberately carries no `Cookie`, `Authorization`, `Referer`, or `Origin`
     * header. Without a session cookie the stateful-request path is skipped
     * entirely, so CSRF and session handling never run — and the guard's cached
     * user means the sub-request still authenticates as exactly the same
     * identity, with the same token instance. The failure mode is closed: if
     * that cache were somehow cold the request 401s, never escalates.
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
     * `convertExceptionToArray()` injects `source.file`, `source.line`, and a
     * full `meta.trace` when APP_DEBUG is on. None of that may reach the model
     * context — it would be echoed to the user's screen over SSE — so only the
     * detail string is ever read, never the surrounding envelope.
     *
     * A 5xx detail is not read either, in any mode. With APP_DEBUG on it is the
     * raw exception message, which routinely carries SQL, table names and
     * absolute paths; with it off, controllers that wrap their failures
     * (`'Failed to update a product: ' . $ex->getMessage()`) put the same thing
     * through the same door. Nothing in it is actionable to a model anyway: a
     * 5xx means wait and retry, and the original exception is already in the
     * server's own log, where it belongs. The 5xx statuses the *node* raises
     * are answered from the table below for the same reason — Wings has already
     * flattened those to generic prose before the panel sees them.
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
     * Unwrap the daemon's error envelope.
     *
     * `DaemonConnectionException` wraps whatever the node reported in prose and
     * appends a request id, so a plain "no such directory" reaches the model as
     * "An error occurred on the remote host: … (request id: <nil>)". The
     * wrapper is noise the model has to reason past and the request id means
     * nothing to it — both cost tokens on every subsequent step of the turn.
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

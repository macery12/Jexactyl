<?php

namespace Everest\Http\Controllers\Api\Concerns;

use Everest\Models\Server;
use Everest\Models\Setting;
use Illuminate\Support\Str;
use Illuminate\Http\Request;
use Everest\Models\AiToolCall;
use Everest\Models\AiUsageLog;
use Illuminate\Http\JsonResponse;
use Everest\Models\AiConversation;
use Everest\Models\AiPendingAction;
use Illuminate\Support\Facades\Log;
use Everest\Jobs\AI\RunAgentTurnJob;
use Everest\Services\AI\Data\AiMessage;
use Everest\Services\AI\Tools\RiskGate;
use Everest\Services\AI\ProviderFactory;
use Everest\Services\AI\Agent\AgentEvent;
use Everest\Services\AI\Agent\AgentRunner;
use Everest\Services\AI\Agent\AssistGrant;
use Everest\Services\AI\Agent\AgentContext;
use Everest\Services\AI\Agent\TurnRecorder;
use Everest\Services\AI\Tools\ToolRegistry;
use Everest\Services\AI\Agent\AgentEventLog;
use Everest\Services\AI\Agent\TurnAuthority;
use Everest\Services\AI\Inference\Admission;
use Everest\Services\AI\Inference\TurnLease;
use Everest\Services\AI\Privacy\RedactionMap;
use Everest\Services\AI\Agent\ApprovalPreview;
use Everest\Services\AI\Agent\AssistAuthorizer;
use Everest\Services\AI\Agent\TurnCancellations;
use Everest\Services\AI\Inference\InferenceGate;
use Everest\Services\AI\Support\AiBudgetReservation;
use Everest\Services\AI\Support\AiTurnUsageRecorder;
use Everest\Exceptions\Service\AI\AIServiceException;
use Everest\Services\AI\Tools\Definitions\AdminTools;
use Everest\Services\AI\Tools\Definitions\SharedTools;
use Symfony\Component\HttpFoundation\StreamedResponse;
use Everest\Services\AI\Data\AiToolCall as ToolCallData;
use Symfony\Component\HttpKernel\Exception\ServiceUnavailableHttpException;

/**
 * Running an agent turn over SSE, and resuming one that suspended.
 *
 * Shared between the server and admin assistants because the hard parts are
 * identical: answering a suspended call with the id the model actually issued,
 * closing the sibling calls a suspension stranded, and re-checking authorization
 * on resume rather than trusting what was stored.
 *
 * A trait rather than a base class because the two controllers sit in different
 * hierarchies (client versus application API); the using class supplies its
 * dependencies through the accessors below.
 */
trait HandlesAgentTurns
{
    /** A crashed claimant is failed closed after this lease. It is never replayed. */
    protected const PENDING_CLAIM_MINUTES = 10;

    abstract protected function agentRunner(): AgentRunner;

    abstract protected function toolRegistry(): ToolRegistry;

    abstract protected function toolRiskGate(): RiskGate;

    abstract protected function turnRecorder(): TurnRecorder;

    abstract protected function providerFactory(): ProviderFactory;

    /**
     * Run a turn and write its events to an SSE stream.
     */
    protected function streamTurn(
        AgentContext $context,
        ?AiPendingAction $resuming = null,
        ?AiConversation $conversation = null,
        ?AiBudgetReservation $budgetReservation = null,
        ?TurnLease $lease = null,
    ): StreamedResponse {
        $turnId = $context->turnId;
        $idleSeconds = $this->agentRunner()->streamIdleSeconds();

        return response()->stream(
            fn () => $this->executeTurn($context, $resuming, $conversation, $budgetReservation, $lease),
            200,
            [
                'Content-Type' => 'text/event-stream',
                'Cache-Control' => 'no-cache',
                'X-Accel-Buffering' => 'no',
                'X-Agent-Turn-Id' => $turnId,
                'X-Agent-Idle-Seconds' => (string) $idleSeconds,
            ]
        );
    }

    /**
     * Read a durable turn as an event stream, from a cursor.
     *
     * The relay is not the turn: it holds no lease, executes nothing, and can be
     * dropped and reopened freely, so a browser that navigates away or returns on
     * another device resumes from wherever it got to. Several readers can watch
     * one turn for the same reason.
     *
     * `after` is the client's own high-water mark, so a reconnect costs only the
     * frames it actually missed. Terminality comes from the usage row rather than
     * a sentinel, since a reader may arrive after the turn finished; the worker
     * writes that row before stopping, so a finished turn guarantees a complete
     * log.
     */
    protected function relayTurn(
        $user,
        string $turnId,
        ?Server $server,
        string $scope,
        int $after,
    ): StreamedResponse {
        if (!Str::isUuid($turnId)) {
            abort(404);
        }

        // Authorization is the same question the status endpoint asks, and it is
        // asked here rather than inside the stream because a 404 must be a 404
        // rather than a 200 whose body says so.
        $usage = $this->ownedTurnUsage($user, $turnId, $server);
        $events = app(AgentEventLog::class);
        $idleSeconds = $this->agentRunner()->streamIdleSeconds();

        return response()->stream(function () use ($usage, $turnId, $events, $after): void {
            $cursor = max(0, $after);

            // A reader that is already up to date would otherwise sit silent
            // until the first new frame, which is indistinguishable from a
            // stream that never opened.
            $this->sendComment('keep-alive');

            // Bounded by the turn's own persisted deadline plus a margin, so a
            // relay cannot outlive the thing it is relaying even if the worker
            // vanished without writing a terminal row. The sweep in
            // `agentTurnStatus()` closes that row out; this just stops waiting.
            $stopAt = ($usage->deadline_at !== null ? $usage->deadline_at->timestamp : time() + 900) + 60;

            while (true) {
                $cursor = $this->drainFrames($events, $turnId, $cursor);

                if ($this->turnIsTerminal($turnId)) {
                    // Drain once more before stopping. The worker writes the
                    // terminal row after its final frame, so a read that
                    // straddles the two would otherwise truncate the answer.
                    $this->drainFrames($events, $turnId, $cursor);

                    break;
                }

                if (time() >= $stopAt) {
                    break;
                }

                // Sleeps until something is appended, or the interval elapses.
                // The return value is deliberately ignored: the loop re-reads
                // the log either way, so a spurious wake costs one indexed
                // query and a missed one costs a single interval.
                $events->awaitChange($turnId, $cursor, 5.0);

                $this->sendComment('keep-alive');
            }

            $this->sendTerminal();
        }, 200, [
            'Content-Type' => 'text/event-stream',
            'Cache-Control' => 'no-cache',
            'X-Accel-Buffering' => 'no',
            'X-Agent-Turn-Id' => $turnId,
            'X-Agent-Idle-Seconds' => (string) $idleSeconds,
        ]);
    }

    /**
     * Write every frame past the cursor, returning the new cursor.
     *
     * Each frame carries its sequence as the SSE `id`, which is what a client
     * reconnecting later presents as `after` — so the resume point is the
     * reader's own, not something the server has to remember per reader.
     */
    protected function drainFrames(AgentEventLog $events, string $turnId, int $cursor): int
    {
        foreach ($events->replay($turnId, $cursor) as $frame) {
            $cursor = $frame['seq'];
            $this->write('id: ' . $cursor);
            $this->write('data: ' . json_encode($frame['event']));
        }

        return $cursor;
    }

    /**
     * The caller's in-flight turn, or `null` when they have none. Deliberately
     * thin — the transcript, frames and terminal detail each have their own
     * endpoint, and duplicating them here would give a reconnecting client two
     * sources for one fact.
     *
     * A row whose worker died is not reported as running: the status endpoint's
     * deadline sweep runs first, so a reload during an outage shows a failed turn
     * rather than a spinner that never resolves.
     */
    protected function activeAgentTurn($user, ?Server $server): JsonResponse
    {
        $query = AiUsageLog::query()
            ->where('user_id', $user->id)
            ->whereIn('status', ['running', 'suspended']);

        if ($server !== null) {
            $query->where('server_uuid', $server->uuid)->where('source', 'agent');
        } else {
            $query->whereNull('server_uuid')->where('source', 'admin-agent');
        }

        /** @var AiUsageLog|null $usage */
        $usage = $query->latest('id')->first();

        if ($usage === null) {
            return response()->json(['data' => null]);
        }

        if (
            $usage->status === 'running'
            && $usage->deadline_at !== null
            && $usage->deadline_at->copy()->addSeconds(30)->isPast()
        ) {
            AiUsageLog::whereKey($usage->id)
                ->where('status', 'running')
                ->update([
                    'status' => 'error',
                    'error_message' => 'The agent worker did not finalize before its persisted deadline.',
                    'heartbeat_at' => now(),
                ]);

            return response()->json(['data' => null]);
        }

        return response()->json(['data' => [
            'turn_id' => $usage->turn_id,
            'conversation_id' => $usage->conversation_id,
            'status' => $usage->status,
            'step' => (int) $usage->step,
            'started_at' => $usage->created_at?->toIso8601String(),
            'heartbeat_at' => $usage->heartbeat_at?->toIso8601String(),
            'deadline_at' => $usage->deadline_at?->toIso8601String(),
            // The relay's cursor origin. A client that has seen nothing asks for
            // everything; one that is resuming presents its own high-water mark.
            'latest_seq' => app(AgentEventLog::class)->latestSequence((string) $usage->turn_id),
        ]]);
    }

    /** Whether the turn has reached a state nothing more will be appended to. */
    protected function turnIsTerminal(string $turnId): bool
    {
        return AiUsageLog::query()
            ->where('turn_id', $turnId)
            ->where('status', 'running')
            ->doesntExist();
    }

    /**
     * The caller's own usage row for a turn, or a 404.
     *
     * Scoped exactly as `agentTurnStatus()` scopes it — same user, same server,
     * same source — so a turn cannot be read from a different server's chat or
     * from the admin surface.
     */
    protected function ownedTurnUsage($user, string $turnId, ?Server $server): AiUsageLog
    {
        $query = AiUsageLog::query()
            ->where('turn_id', $turnId)
            ->where('user_id', $user->id);

        if ($server !== null) {
            $query->where('server_uuid', $server->uuid)->where('source', 'agent');
        } else {
            $query->whereNull('server_uuid')->where('source', 'admin-agent');
        }

        return $query->firstOrFail();
    }

    /**
     * Whether turns run on a queue worker rather than inside the request.
     *
     * A runtime setting rather than a deploy-time constant, so an operator who
     * finds durable execution misbehaving can put it back without shipping code
     * — and so an install whose `agent` queue lane is not staffed can be moved
     * off it immediately, rather than accepting turns nothing will ever run.
     */
    protected function agentDurable(): bool
    {
        return filter_var(
            Setting::get('settings::modules:ai:agent:durable', config('modules.ai.agent.durable')),
            FILTER_VALIDATE_BOOLEAN
        );
    }

    /**
     * Hand a turn to a worker and answer the request immediately.
     *
     * The usage row is written *here*, before the job dispatches, and that
     * ordering is the point: it makes the turn discoverable between acceptance
     * and pickup, so a client reloading in that gap does not conclude nothing was
     * happening.
     *
     * `deadline_at` is deliberately generous — it is the sweep's only evidence a
     * worker died, and counting queue wait against the execution budget would
     * fail healthy turns during a backlog. The worker replaces it on start.
     */
    protected function dispatchDurableTurn(
        AgentContext $context,
        ?AiConversation $conversation,
        ?AiBudgetReservation $budgetReservation,
        ?TurnLease $lease,
    ): JsonResponse {
        $runner = $this->agentRunner();
        $serverUuid = $context->server?->uuid;
        $grace = $runner->maxWallSeconds() + 300;

        app(AiTurnUsageRecorder::class)->record($context->turnId, [
            'user_id' => $context->user->id,
            'server_uuid' => $serverUuid,
            'conversation_id' => $context->conversationId,
            'step' => 0,
            'tool_calls_count' => 0,
            'model' => $this->providerFactory()->model(ProviderFactory::TASK_AGENT) ?: 'unknown',
            'source' => $serverUuid === null ? 'admin-agent' : 'agent',
            'prompt_tokens' => 0,
            'completion_tokens' => 0,
            'total_tokens' => 0,
            'latency_ms' => 0,
            'status' => 'running',
            'error_message' => null,
            'heartbeat_at' => now(),
            'deadline_at' => now()->addSeconds($grace),
        ]);

        // Dispatched after the row above is committed, so a worker that starts
        // instantly cannot find the turn it was given no trace of.
        RunAgentTurnJob::dispatch(
            $context->turnId,
            TurnAuthority::capture(request(), $context->user)->toArray(),
            $serverUuid,
            $context->conversationId,
            $context->consoleBuffer,
            $lease?->handle(),
            $budgetReservation?->handle(),
        )->afterCommit();

        return response()->json(['data' => array_filter([
            'turn_id' => $context->turnId,
            'conversation_id' => $conversation?->id,
            'conversation_title' => $conversation?->title,
            'durable' => true,
        ], fn ($value) => $value !== null)]);
    }

    /**
     * Run a turn to a terminal state, emitting as it goes.
     *
     * Extracted from the streaming response so *where* a turn runs is a separate
     * decision from *what* running one means: request-bound turns call this inside
     * `response()->stream()`, durable ones from a worker with `send()` pointed at
     * the event log. Everything that makes a turn correct lives here once — the
     * running usage row, the heartbeat, resolving a resumed pending action,
     * failing open tool calls on throw, and persisting terminal state before the
     * sentinel.
     *
     * Releases the lease and budget reservation on every path out, including ones
     * that throw before the loop runs.
     */
    protected function executeTurn(
        AgentContext $context,
        ?AiPendingAction $resuming = null,
        ?AiConversation $conversation = null,
        ?AiBudgetReservation $budgetReservation = null,
        ?TurnLease $lease = null,
    ): void {
        $runner = $this->agentRunner();
        $recorder = $this->turnRecorder();
        $userId = $context->user->id;
        $serverUuid = $context->server?->uuid;
        $turnId = $context->turnId;
        $conversationId = $context->conversationId;
        $model = $this->providerFactory()->model(ProviderFactory::TASK_AGENT);

        $usageReconciled = $budgetReservation === null || $budgetReservation->passthrough;

        try {
            $startedAt = microtime(true);
            $deadlineAt = now()->setTimestamp((int) ceil($runner->beginDeadline($context)));
            app(AiTurnUsageRecorder::class)->record($turnId, [
                'user_id' => $userId,
                'server_uuid' => $serverUuid,
                'conversation_id' => $conversationId,
                'step' => $context->step,
                'tool_calls_count' => $context->toolCalls,
                'model' => $model ?: 'unknown',
                'source' => $serverUuid === null ? 'admin-agent' : 'agent',
                'prompt_tokens' => $context->usage['prompt_tokens'],
                'completion_tokens' => $context->usage['completion_tokens'],
                'total_tokens' => $context->usage['total_tokens'],
                'latency_ms' => 0,
                'status' => 'running',
                'error_message' => null,
                'heartbeat_at' => now(),
                'deadline_at' => $deadlineAt,
            ]);

            // Flush a comment immediately so proxies do not 504 while the model
            // is still thinking or the turn is queued.
            $this->sendComment('keep-alive');

            if ($conversation !== null) {
                $this->send(AgentEvent::conversation($conversation->id, (string) $conversation->title));
            }

            // Re-announced at the top of every turn that carries one, so the
            // banner naming the customer's server is on screen before the first
            // token arrives rather than only on the turn that opened it.
            if ($context->assist !== null && $context->targetServer() !== null) {
                $this->send(AgentEvent::assist(
                    $context->assist->serverUuid,
                    $context->assist->serverName,
                    $context->assist->writable,
                    $context->assist->reason,
                ));
            }

            $status = 'success';
            $error = null;
            $lastHeartbeat = microtime(true);
            $emit = function (AgentEvent $event) use ($context, $turnId, &$lastHeartbeat): void {
                if ($event->type === AgentEvent::TYPE_TOOL_CALL) {
                    ++$context->toolCalls;
                }

                if (microtime(true) - $lastHeartbeat >= 15) {
                    AiUsageLog::where('turn_id', $turnId)
                        ->where('status', 'running')
                        ->update(['heartbeat_at' => now()]);
                    $lastHeartbeat = microtime(true);
                }

                $this->send($event);
            };

            try {
                // Approval execution, any following queue wait and the resumed
                // loop share one allowance. This must happen before the
                // approved tool; otherwise a batch and its follow-up inference
                // each receive a full clock.
                $runner->beginDeadline($context);

                if ($resuming !== null) {
                    $this->resumeSuspendedCall($runner, $context, $resuming, $emit);
                }

                $runner->run($context, $emit);
                $status = match (true) {
                    $context->suspended => 'suspended',
                    // A stop is a clean ending, not a failure: whatever ran
                    // ran and reported, and the transcript is answerable.
                    // It is its own terminal state because "the user
                    // stopped it" and "it broke" are different facts, and
                    // an operator reading a usage row is entitled to know
                    // which one happened.
                    $context->cancelled => 'cancelled',
                    default => 'success',
                };

                if ($resuming !== null) {
                    AiPendingAction::whereKey($resuming->id)
                        ->where('status', AiPendingAction::STATUS_EXECUTING)
                        ->update([
                            'status' => AiPendingAction::STATUS_COMPLETED,
                            'resolved_at' => now(),
                        ]);
                }
            } catch (\Throwable $e) {
                $status = 'error';

                if ($resuming !== null) {
                    AiPendingAction::whereKey($resuming->id)
                        ->where('status', AiPendingAction::STATUS_EXECUTING)
                        ->update([
                            'status' => AiPendingAction::STATUS_FAILED,
                            'resolved_at' => now(),
                            'failure_reason' => 'Execution stopped before completion.',
                        ]);
                }

                // A call that was marked running and never resolved is the
                // one thing an audit trail must not leave open: it reads as
                // work still in flight forever. The transition is
                // conditional, so a turn that suspended again on its way
                // out keeps its fresh approval row untouched.
                AiToolCall::where('turn_id', $turnId)
                    ->where('status', AiToolCall::STATUS_RUNNING)
                    ->update([
                        'status' => AiToolCall::STATUS_FAILED,
                        'result_summary' => 'The turn ended before this call reported a result.',
                        'resolved_at' => now(),
                    ]);

                Log::error('AI agent stream failed for user ' . $userId . ': ' . $e->getMessage());

                // Only our own messages are quotable. Anything else can
                // carry SQL, absolute paths or internal detail — which
                // APP_DEBUG makes routine — and both the SSE frame and the
                // stored row are read by a browser.
                $error = $e instanceof AIServiceException
                    ? $e->getMessage()
                    : 'The AI ran into a problem. Please try again.';
                $this->send(AgentEvent::error($error));
            }

            // Rolls the conversation's expiry forward the same way a manual
            // append does, so an active chat is not reaped mid-use, and banks
            // the turn's redaction tokens and assist session against the
            // conversation so neither has to be re-established on the next turn.
            $persistenceFailed = !$recorder->touch($conversation, $context);
            if ($persistenceFailed) {
                $status = 'error';
                $error = 'The turn finished, but its conversation state could not be persisted.';
            }

            try {
                app(AiTurnUsageRecorder::class)->record($turnId, [
                    'user_id' => $userId,
                    'server_uuid' => $serverUuid,
                    'conversation_id' => $conversationId,
                    'step' => $context->step,
                    'tool_calls_count' => $context->toolCalls,
                    'model' => $model ?: 'unknown',
                    'source' => $serverUuid === null ? 'admin-agent' : 'agent',
                    // Summed across every model call the turn made, not just
                    // the last one. Without these the monthly token budget has
                    // nothing to count on precisely the workload that spends
                    // the most — an agent turn is many calls, a chat is one.
                    'prompt_tokens' => $context->usage['prompt_tokens'],
                    'completion_tokens' => $context->usage['completion_tokens'],
                    'total_tokens' => $context->usage['total_tokens'],
                    'latency_ms' => (int) round((microtime(true) - $startedAt) * 1000),
                    'status' => $status,
                    'error_message' => $error,
                    'heartbeat_at' => now(),
                    'deadline_at' => $deadlineAt,
                ]);
                $usageReconciled = true;
            } catch (\Throwable $e) {
                Log::warning('Failed to write AI usage log: ' . $e->getMessage());
                $this->send(AgentEvent::error(
                    'The turn ended, but its terminal state could not be persisted. Reload before retrying.'
                ));

                return;
            }

            if ($persistenceFailed) {
                $this->send(AgentEvent::error(
                    'The turn ended, but its conversation state could not be persisted. Reload before retrying.'
                ));

                return;
            }

            // The sentinel acknowledges both execution and terminal
            // persistence. EOF before it is therefore always uncertain and
            // triggers the client's authoritative status reconciliation.
            $this->sendTerminal();
        } finally {
            // The inference slot belongs to the stream rather than to the
            // runner: it is taken before the turn is built — early enough
            // that a queued turn can be turned away having changed nothing
            // — so it has to be given back here, on every path out
            // including the ones that threw before the loop ever ran.
            $lease?->release();

            // Admission remains held until the cumulative row above has
            // replaced the previous suspension leg. The next request can
            // therefore never observe stale spend at the boundary.
            if ($usageReconciled) {
                $budgetReservation?->release();
            }
        }
    }

    /**
     * Ask for an inference slot before the turn changes anything. Asking here,
     * before the user's message is recorded or an approved action is claimed, is
     * what makes "come back shortly" a safe answer — a caller cannot be turned
     * away once effects have landed.
     *
     * @throws AIServiceException when the queue is full, the caller already has
     *                            a turn in flight, or a ticket has lapsed
     */
    protected function admitTurn(Request $request, $user, string $lane): Admission
    {
        $ticket = $request->input('ticket');

        try {
            return app(InferenceGate::class)->admit(
                (string) $user->uuid,
                $lane,
                is_string($ticket) && $ticket !== '' ? $ticket : null,
            );
        } catch (AIServiceException $e) {
            // The gate's refusals are written for this audience — a full queue,
            // a lapsed place, a turn the user already has running — and they
            // used to reach the browser because admission happened inside the
            // stream, where the error frame quotes our own exceptions. Asking
            // before the stream opens means saying it in HTTP instead, or the
            // user gets a bare 500 in place of a sentence explaining the wait.
            throw new ServiceUnavailableHttpException(5, $e->getMessage(), $e);
        }
    }

    /**
     * Tell the client where it stands, and stop.
     *
     * Written as SSE rather than a JSON 429 so the browser's existing reader
     * handles it on the same code path as a turn that ran: one transport, one
     * set of failure modes. Deliberately carries no `X-Agent-Turn-Id` — nothing
     * has started, so there is no turn to reconcile against if this response is
     * itself lost, and the client must simply present its ticket again.
     */
    protected function queuedResponse(Admission $admission): StreamedResponse
    {
        $queued = $admission->toArray();

        return response()->stream(function () use ($queued): void {
            $this->sendComment('keep-alive');
            $this->send(AgentEvent::queued(
                $queued['position'],
                $queued['ahead'],
                $queued['eta_seconds'],
                $queued['ticket'],
                $queued['retry_after_ms'],
            ));
            $this->send(AgentEvent::done('queued'));
            $this->sendTerminal();
        }, 200, [
            'Content-Type' => 'text/event-stream',
            'Cache-Control' => 'no-cache',
            'X-Accel-Buffering' => 'no',
        ]);
    }

    /**
     * Give up a queue place.
     *
     * Its own endpoint rather than a flag on the cancel one, because a queued
     * turn and a running turn are different things: one has a ticket and no
     * turn id, the other has a turn id and no ticket, and nothing has happened
     * in the first case. Ownership is checked against the ticket itself, so
     * presenting somebody else's is the same as presenting a lapsed one.
     */
    protected function releaseQueuePlace($user, string $ticket): JsonResponse
    {
        $released = app(InferenceGate::class)->releaseTicket($ticket, (string) $user->uuid);

        return response()->json(['data' => ['released' => $released]]);
    }

    /**
     * Ask a running turn to stop. Scoped exactly as the status endpoint is, since
     * a turn one user may read is the turn that user may stop.
     *
     * The response reports that the request was *recorded*, not that the turn
     * ended; the client learns the second by reconciling. A tool in flight always
     * finishes — an HTTP call through the panel's own middleware cannot be
     * un-started — so this stops scheduling work rather than pretending to recall
     * the last of it.
     */
    protected function cancelAgentTurn(
        $user,
        string $turnId,
        ?Server $server,
        string $scope,
    ): JsonResponse {
        if (!Str::isUuid($turnId)) {
            abort(404);
        }

        $query = AiUsageLog::query()
            ->where('turn_id', $turnId)
            ->where('user_id', $user->id);

        if ($server !== null) {
            $query->where('server_uuid', $server->uuid)->where('source', 'agent');
        } else {
            $query->whereNull('server_uuid')->where('source', 'admin-agent');
        }

        $usage = $query->firstOrFail();

        if ($usage->status === 'suspended') {
            // Nothing is executing. The decision the user actually wants is on
            // the card in front of them, and routing them to it is better than
            // quietly accepting a stop that would stop nothing.
            abort(409, 'That turn is waiting for your decision. Decline the action instead.');
        }

        $recorded = $usage->status === 'running'
            && app(TurnCancellations::class)->request($usage);

        return response()->json(['data' => [
            'turn_id' => $turnId,
            'status' => $usage->fresh()->status,
            'cancel_requested' => $recorded || $usage->cancel_requested_at !== null,
        ]]);
    }

    /**
     * Return the persisted truth after a browser loses an accepted stream.
     * A running row cannot live forever: once its server-owned deadline plus a
     * transport grace period passes, it is atomically failed and cannot be
     * mistaken for work that is still safe to retry.
     */
    protected function agentTurnStatus(
        $user,
        string $turnId,
        ?Server $server,
        string $scope,
    ): JsonResponse {
        if (!Str::isUuid($turnId)) {
            abort(404);
        }

        $query = AiUsageLog::query()
            ->where('turn_id', $turnId)
            ->where('user_id', $user->id);

        if ($server !== null) {
            $query->where('server_uuid', $server->uuid)->where('source', 'agent');
        } else {
            $query->whereNull('server_uuid')->where('source', 'admin-agent');
        }

        $usage = $query->firstOrFail();
        if (
            $usage->status === 'running'
            && $usage->deadline_at !== null
            && $usage->deadline_at->copy()->addSeconds(30)->isPast()
        ) {
            AiUsageLog::whereKey($usage->id)
                ->where('status', 'running')
                ->update([
                    'status' => 'error',
                    'error_message' => 'The agent worker did not finalize before its persisted deadline.',
                    'heartbeat_at' => now(),
                ]);
            $usage->refresh();
        }

        $terminal = $usage->status !== 'running';
        $conversation = null;
        if ($terminal && $usage->conversation_id !== null) {
            $conversation = AiConversation::query()
                ->whereKey($usage->conversation_id)
                ->where('user_id', $user->id)
                ->where('scope', $scope)
                ->where('server_uuid', $server?->uuid)
                ->first();
        }

        $pending = null;
        if ($usage->status === 'suspended') {
            $pendingQuery = AiPendingAction::query()
                ->where('turn_id', $turnId)
                ->where('user_id', $user->id)
                ->where('scope', $scope)
                ->where('status', AiPendingAction::STATUS_PENDING);

            if ($server !== null) {
                $pendingQuery->where('server_uuid', $server->uuid);
            }

            $action = $pendingQuery->first();
            if ($action !== null) {
                $arguments = (array) $action->arguments;
                $pending = $action->tool_name === SharedTools::ASK_USER
                    ? [
                        'kind' => 'question',
                        'turn_id' => $action->turn_id,
                        'tool' => $action->tool_name,
                        'question' => (string) ($arguments['question'] ?? ''),
                        'options' => SharedTools::normaliseOptions($arguments['options'] ?? []),
                        'allow_other' => (bool) ($arguments['allow_other'] ?? false),
                    ]
                    : [
                        'kind' => 'approval',
                        'turn_id' => $action->turn_id,
                        'tool' => $action->tool_name,
                        'arguments' => $arguments,
                        'risk' => $action->risk,
                        'preview' => ApprovalPreview::for(
                            $action->tool_name,
                            $arguments,
                            $action->server_uuid
                                ? Server::where('uuid', $action->server_uuid)->first()
                                : null,
                        ),
                    ];
            }
        }

        return response()->json(['data' => array_filter([
            'turn_id' => $turnId,
            'status' => $usage->status,
            'terminal' => $terminal,
            'error' => $usage->error_message,
            'conversation_id' => $conversation?->id,
            'heartbeat_at' => $usage->heartbeat_at?->toIso8601String(),
            'deadline_at' => $usage->deadline_at?->toIso8601String(),
            'redactions' => $conversation === null
                ? null
                : RedactionMap::fromArray($conversation->redactions)->all(),
            'assist' => $conversation?->assist,
            'pending' => $pending,
            'messages' => $conversation?->messages->map(fn ($message) => [
                'role' => $message->role,
                'content' => $message->content,
                'tool_calls' => $message->tool_calls,
                'tool_call_id' => $message->tool_call_id,
                'tool_name' => $message->tool_name,
                'step' => $message->step,
            ])->values(),
        ], fn ($value) => $value !== null)]);
    }

    /**
     * Rebuild a suspended turn.
     *
     * The recorder is attached only after the stored messages are restored, so
     * resuming replays the earlier half into the model without writing it to
     * the transcript a second time.
     */
    protected function restoreTurn(AiPendingAction $pending, $user, ?Server $server): AgentContext
    {
        $context = AgentContext::fromState(
            $user,
            $server,
            $pending->turn_id,
            $pending->conversation_id,
            $pending->state,
        )->withRecorder($this->turnRecorder());

        $this->restoreAssist($context, $pending);

        return $context;
    }

    /**
     * Re-attach an assist session to its server, or drop it. `fromState()`
     * rebuilds a binding inert; it becomes real again only if the server still
     * exists and the administrator still holds `servers.assist`. Neither answer
     * is read from the stored blob, whose Access Profile may have narrowed while
     * the approval sat on screen.
     *
     * A binding failing either check is dropped, and the turn resumes on the
     * admin surface with no access to the customer's server.
     */
    protected function restoreAssist(AgentContext $context, ?AiPendingAction $pending = null): void
    {
        if ($pending !== null && $context->scope() === \Everest\Services\AI\Tools\ToolDefinition::SCOPE_ADMIN) {
            $state = $pending->state;
            $rawBinding = $state['assist'] ?? null;
            // Every admin pending action is authenticated, including the
            // explicit no-assist phase. Otherwise an attacker could bypass an
            // assist signature simply by removing the grant columns and
            // retargeting the rest of the pending row.
            $grant = AssistGrant::verify(
                $pending->assist_grant,
                $pending->assist_grant_mac,
                (string) $pending->turn_id,
                (int) $pending->user_id,
                (string) $pending->tool_name,
                (array) $pending->arguments,
            );

            $phaseMatchesTool = $grant !== null && match ($grant->phase) {
                AssistGrant::PHASE_NONE => !in_array(
                    $pending->tool_name,
                    [AdminTools::ASSIST_SERVER, AdminTools::ASSIST_ALLOW_WRITES],
                    true,
                ),
                AssistGrant::PHASE_OPEN => $pending->tool_name === AdminTools::ASSIST_SERVER,
                AssistGrant::PHASE_ESCALATE => $pending->tool_name === AdminTools::ASSIST_ALLOW_WRITES,
                AssistGrant::PHASE_ACTIVE => !in_array(
                    $pending->tool_name,
                    [AdminTools::ASSIST_SERVER, AdminTools::ASSIST_ALLOW_WRITES],
                    true,
                ),
                default => false,
            };

            if (
                $grant === null
                || !$phaseMatchesTool
                || !$grant->matchesState($rawBinding)
                || ($grant->after === null
                    ? $pending->server_uuid !== null
                    : !hash_equals($grant->after->serverUuid, (string) $pending->server_uuid))
            ) {
                $context->assist = null;
                $context->pendingAssistAuthorityInvalid = true;

                return;
            }

            if ($grant->phase === AssistGrant::PHASE_NONE) {
                $context->assist = null;
                $context->pendingAssistGrant = $grant;

                return;
            }

            // Re-authorize against the approved target even for an opening
            // grant, but do not activate it until the audit row is durable.
            $authorizer = app(AssistAuthorizer::class);
            $server = $authorizer->reauthorize($context->user, $grant->after);
            if ($server === null) {
                $context->assist = null;
                $context->pendingAssistAuthorityInvalid = true;

                return;
            }

            $context->pendingAssistGrant = $grant;
            if ($grant->before !== null) {
                $context->bindAssist($grant->before, $server);
            } else {
                $context->assist = null;
            }

            return;
        }

        $binding = $context->assist;

        if ($binding === null || $context->pendingAssistUuid() === null) {
            return;
        }

        $authorizer = app(AssistAuthorizer::class);
        $server = $authorizer->reauthorize($context->user, $binding);

        if ($server === null) {
            $context->assist = null;

            return;
        }

        $context->bindAssist($binding, $server);
    }

    /**
     * The conversation a resume may bank its state into, if there is one.
     *
     * Three outcomes, not two — "gone" and "not yours" are different facts. A
     * conversation is reaped when a user exceeds their unsaved-chat cap, and
     * an approval outliving its transcript is ordinary: the turn still runs,
     * it just has nowhere to write the tokens it mints. A conversation
     * that's *there* but belongs to another user, surface, or server is a
     * boundary failure, and the resume stops rather than writing across it.
     */
    protected function ownedPendingConversation(
        AiPendingAction $pending,
        int $userId,
        string $scope,
        ?string $serverUuid,
    ): ?AiConversation {
        $conversation = AiConversation::query()->whereKey($pending->conversation_id)->first();

        if ($conversation === null) {
            return null;
        }

        if (
            (int) $conversation->user_id !== $userId
            || $conversation->scope !== $scope
            || $conversation->server_uuid !== $serverUuid
        ) {
            abort(409, 'The conversation for this pending action is no longer available.');
        }

        return $conversation;
    }

    /**
     * Which decisions a pending action will accept. A question and an approval
     * are not interchangeable: `ask_user` accepting `decision=approve` resumes the
     * turn with no tool result for the call the model made, a transcript no
     * provider accepts. Both kinds can still be refused — dismissing a question is
     * a real answer.
     *
     * Checked before anything is claimed, so an invalid combination leaves the
     * action exactly as it was.
     */
    protected function assertDecisionMatchesPending(AiPendingAction $pending, string $decision): void
    {
        $isQuestion = $pending->tool_name === SharedTools::ASK_USER;

        if ($decision === 'answer' && !$isQuestion) {
            abort(422, 'That pending action is waiting for approval, not an answer.');
        }

        if ($decision === 'approve' && $isQuestion) {
            abort(422, 'That pending action is a question. Answer it or dismiss it.');
        }
    }

    /**
     * The answer as it will actually be written, or a 422.
     *
     * Validated against the options as they were *persisted*, not as the
     * client reports them — otherwise the client could write anything into
     * the transcript the model reads next. Separate from `applyAnswer()` so
     * the refusal happens before the row is claimed: claiming first left a
     * mistyped answer stuck in `executing` until its lease expired, unable
     * to be answered again.
     */
    protected function assertAnswerAcceptable(AiPendingAction $pending, string $answer): string
    {
        $arguments = (array) $pending->arguments;
        $options = SharedTools::normaliseOptions($arguments['options'] ?? []);
        $answer = trim($answer);

        foreach (array_column($options, 'label') as $label) {
            if (strcasecmp($label, $answer) === 0) {
                return $label;
            }
        }

        if (!(bool) ($arguments['allow_other'] ?? false)) {
            abort(422, 'Choose one of the answers offered.');
        }

        return $answer;
    }

    /**
     * Feed the user's answer back and let the loop carry on.
     */
    protected function applyAnswer(AiPendingAction $pending, AgentContext $context, string $answer): void
    {
        $accepted = $this->assertAnswerAcceptable($pending, $answer);

        $pending->update([
            'status' => AiPendingAction::STATUS_COMPLETED,
            'resolved_at' => now(),
        ]);

        $context->push(
            AiMessage::tool(
                $this->resolveToolCallId($pending, $context),
                SharedTools::ASK_USER,
                json_encode(['ok' => true, 'answer' => $accepted]),
            ),
            TurnRecorder::toolDisplay(true, $accepted),
        );

        $this->closeUnresolvedCalls($context);
    }

    /**
     * Run the call the user just approved, then let the loop carry on.
     */
    protected function resumeSuspendedCall(
        AgentRunner $runner,
        AgentContext $context,
        AiPendingAction $pending,
        ?callable $emit = null,
    ): void {
        if ($pending->status !== AiPendingAction::STATUS_EXECUTING) {
            return;
        }

        // A question was already answered into the transcript by applyAnswer();
        // there is nothing to execute.
        if ($pending->tool_name === SharedTools::ASK_USER) {
            return;
        }

        $definition = $this->toolRegistry()->find($pending->tool_name);
        $callId = $this->resolveToolCallId($pending, $context);
        $audit = AiToolCall::where('turn_id', $pending->turn_id)
            ->where('tool_call_id', $callId)
            ->where('tool_name', $pending->tool_name)
            ->where('status', AiToolCall::STATUS_PENDING_APPROVAL)
            ->first();

        if ($context->pendingAssistAuthorityInvalid) {
            $context->push(
                AiMessage::tool(
                    $callId,
                    $pending->tool_name,
                    json_encode([
                        'ok' => false,
                        'error' => 'invalid_authority',
                        'message' => 'The approved assist grant no longer matches its authenticated state.',
                    ]),
                    true,
                ),
                TurnRecorder::toolDisplay(false, 'Assist grant authentication failed'),
            );
            $this->closeUnresolvedCalls($context);
            $audit?->update([
                'status' => AiToolCall::STATUS_FAILED,
                'result_summary' => 'Assist grant authentication failed',
                'resolved_at' => now(),
            ]);

            return;
        }

        if ($definition === null || !$this->stillUsable($context, $definition)) {
            $context->push(
                AiMessage::tool(
                    $callId,
                    $pending->tool_name,
                    json_encode(['ok' => false, 'error' => 'unavailable', 'message' => 'That tool is no longer available.']),
                    true,
                ),
                TurnRecorder::toolDisplay(false, 'No longer available'),
            );
            $this->closeUnresolvedCalls($context);

            $audit?->update([
                'status' => AiToolCall::STATUS_FAILED,
                'result_summary' => 'No longer available',
                'resolved_at' => now(),
            ]);

            return;
        }

        // Re-resolve the tier rather than trusting the stored one: an operator
        // may have hardened the tool while the approval was outstanding.
        $risk = $this->toolRiskGate()->resolve($definition, $pending->arguments);
        $approvedRisk = (string) $pending->risk;

        if (
            !in_array($approvedRisk, \Everest\Services\AI\Tools\ToolDefinition::RISKS, true)
            || $this->toolRiskGate()->max($approvedRisk, $risk) !== $approvedRisk
        ) {
            $message = sprintf(
                'That action now requires "%s" approval, so the earlier approval was not used. Ask for it again.',
                $risk,
            );
            $context->push(
                AiMessage::tool(
                    $callId,
                    $pending->tool_name,
                    json_encode(['ok' => false, 'error' => 'risk_changed', 'message' => $message]),
                    true,
                ),
                TurnRecorder::toolDisplay(false, 'Approval policy changed'),
            );
            $this->closeUnresolvedCalls($context);
            $audit?->update([
                'status' => AiToolCall::STATUS_FAILED,
                'result_summary' => 'Approval policy changed',
                'resolved_at' => now(),
            ]);

            return;
        }

        $call = new ToolCallData($callId, $definition->name, $pending->arguments);
        $emit ??= fn (AgentEvent $event) => $this->send($event);

        $startedAt = microtime(true);
        if ($definition->hostHandled && $audit !== null) {
            $audit->update(['status' => AiToolCall::STATUS_RUNNING, 'resolved_at' => null]);
        }

        $result = $definition->hostHandled
            // The *stored* tier, not the freshly resolved one. For a batch this
            // is the ceiling none of its calls may exceed, and the only record of
            // what the user actually agreed to — re-resolving it would ask the
            // wrong question, since `batch` declares SAFE and is priced by what
            // is inside it.
            ? $runner->runHostTool($context, $call, $definition, $pending->arguments, $emit, $approvedRisk)
            : $runner->runTool($context, $call, $definition, $pending->arguments, $risk, $audit);

        $fresh = $context->redactions->drainFresh();
        if ($fresh !== []) {
            $emit(AgentEvent::redaction($fresh));
        }

        $emit(AgentEvent::toolResult(
            $callId,
            $definition->name,
            $result->ok,
            $result->summary(),
            $result->ok || $result->isBatch() ? $result->data : null,
            (int) round((microtime(true) - $startedAt) * 1000),
            $result->outcome,
        ));

        $context->push(
            AiMessage::tool($callId, $definition->name, $result->toModelPayload(), !$result->ok),
            TurnRecorder::toolDisplay(
                $result->ok,
                $result->summary(),
                $result->outcome,
                $result->isBatch() ? $result->data : null,
            ),
        );

        $this->closeUnresolvedCalls($context);

        if ($definition->hostHandled && $audit !== null) {
            $audit->update([
                'status' => $result->ok ? AiToolCall::STATUS_SUCCEEDED : AiToolCall::STATUS_FAILED,
                'result_summary' => $result->summary(),
                'resolved_at' => now(),
            ]);
        }
    }

    /**
     * Whether an approved call may still run.
     *
     * Delegated to the runner, which asks the same question of every call inside
     * an approved batch. `restoreAssist()` has already re-checked the capability
     * behind any binding by the time this is reached, so a binding present here
     * is one that has just been re-authorized.
     */
    protected function stillUsable(AgentContext $context, $definition): bool
    {
        return $this->agentRunner()->usable($context, $definition);
    }

    /**
     * Resume the turn with a refusal fed back as the tool result, so the model
     * can offer an alternative instead of the conversation dead-ending.
     */
    protected function applyRejection(AiPendingAction $pending, AgentContext $context): void
    {
        $pending->update([
            'status' => AiPendingAction::STATUS_REJECTED,
            'resolved_at' => now(),
        ]);

        AiToolCall::where('turn_id', $pending->turn_id)
            ->where('status', AiToolCall::STATUS_PENDING_APPROVAL)
            ->update(['status' => AiToolCall::STATUS_REJECTED, 'resolved_at' => now()]);

        $declined = $pending->tool_name === SharedTools::ASK_USER
            ? 'The user dismissed the question without answering. Carry on without that detail, or say what you need.'
            : 'The user declined this action. Do not retry it; suggest an alternative or ask what they would prefer.';

        $context->push(
            AiMessage::tool(
                $this->resolveToolCallId($pending, $context),
                $pending->tool_name,
                json_encode(['ok' => false, 'error' => 'declined_by_user', 'message' => $declined]),
                true,
            ),
            TurnRecorder::toolDisplay(false, 'Declined by you'),
        );

        $this->closeUnresolvedCalls($context);
    }

    /**
     * Atomically reserve a pending mutation. Only the request that changes the
     * row from pending to executing receives the execution key.
     */
    protected function claimPending(AiPendingAction $pending): bool
    {
        $key = (string) Str::uuid();
        $claimed = AiPendingAction::whereKey($pending->id)
            ->where('status', AiPendingAction::STATUS_PENDING)
            ->where('expires_at', '>', now())
            ->update([
                'status' => AiPendingAction::STATUS_EXECUTING,
                'execution_key' => $key,
                'claimed_at' => now(),
                'failure_reason' => null,
            ]);

        $pending->refresh();

        return $claimed === 1;
    }

    /** Atomically reserve a non-executing decision such as reject. */
    protected function claimRejection(AiPendingAction $pending): bool
    {
        $claimed = AiPendingAction::whereKey($pending->id)
            ->where('status', AiPendingAction::STATUS_PENDING)
            ->where('expires_at', '>', now())
            ->update([
                'status' => AiPendingAction::STATUS_REJECTED,
                'resolved_at' => now(),
            ]);

        $pending->refresh();

        return $claimed === 1;
    }

    /**
     * Reconcile a claim whose request failed before the stream was handed back.
     * Anything thrown between `claimPending()` and the response would otherwise
     * leave the row `executing` with no writer, indistinguishable from work in
     * flight until its lease expired. Nothing has run at that point, so this
     * closes the row and the audit rows it would have driven.
     *
     * Conditional on the execution key, so it is idempotent and cannot touch a
     * claim that has since progressed, completed or been re-suspended.
     */
    protected function abandonClaim(AiPendingAction $pending, ?AiBudgetReservation $reservation = null): void
    {
        $reservation?->release();

        if ($pending->execution_key === null) {
            return;
        }

        $closed = AiPendingAction::whereKey($pending->id)
            ->where('status', AiPendingAction::STATUS_EXECUTING)
            ->where('execution_key', $pending->execution_key)
            ->update([
                'status' => AiPendingAction::STATUS_FAILED,
                'resolved_at' => now(),
                'failure_reason' => 'The decision could not be started; nothing was run.',
            ]);

        if ($closed === 1) {
            AiToolCall::where('turn_id', $pending->turn_id)
                ->whereIn('status', [AiToolCall::STATUS_PENDING_APPROVAL, AiToolCall::STATUS_RUNNING])
                ->update([
                    'status' => AiToolCall::STATUS_FAILED,
                    'result_summary' => 'The decision could not be started; nothing was run.',
                    'resolved_at' => now(),
                ]);
        }

        $pending->refresh();
    }

    /**
     * Move an expired action, and the call waiting behind it, to a terminal
     * state.
     *
     * Expiry used to be enforced only by reading `expires_at`, so the row went
     * on reporting `pending` forever and its `AiToolCall` went on reporting
     * `pending_approval` — an audit trail that says a change is still awaiting
     * a decision that can no longer be given. The transition is a conditional
     * update rather than a save, so two requests racing an expiry produce one.
     */
    protected function expireIfStale(AiPendingAction $pending): bool
    {
        if ($pending->status !== AiPendingAction::STATUS_PENDING || $pending->isActionable()) {
            return false;
        }

        $expired = AiPendingAction::whereKey($pending->id)
            ->where('status', AiPendingAction::STATUS_PENDING)
            ->where('expires_at', '<=', now())
            ->update(['status' => AiPendingAction::STATUS_EXPIRED, 'resolved_at' => now()]);

        if ($expired === 1) {
            $this->closeExpiredApprovals([$pending->turn_id]);
        }

        $pending->refresh();

        return true;
    }

    /**
     * Do the same sweep across everything a listing is about to report on. Most
     * lapsed actions are simply never returned to, so listing endpoints settle
     * expiry rather than filtering lapsed rows out and leaving them `pending`
     * forever.
     *
     * @param \Illuminate\Database\Eloquent\Builder $scope already narrowed to the
     *                                                     caller's own rows
     */
    protected function sweepExpiredPending($scope): void
    {
        $stale = (clone $scope)
            ->where('status', AiPendingAction::STATUS_PENDING)
            ->where('expires_at', '<=', now())
            ->pluck('turn_id', 'id');

        if ($stale->isEmpty()) {
            return;
        }

        $claimed = AiPendingAction::whereIn('id', $stale->keys()->all())
            ->where('status', AiPendingAction::STATUS_PENDING)
            ->update(['status' => AiPendingAction::STATUS_EXPIRED, 'resolved_at' => now()]);

        if ($claimed > 0) {
            $this->closeExpiredApprovals($stale->values()->all());
        }
    }

    /**
     * The approval rows an expired action leaves behind.
     *
     * Recorded as rejected rather than failed: nothing was attempted, and the
     * outcome the user is entitled to read is that the change did not happen.
     *
     * @param string[] $turnIds
     */
    private function closeExpiredApprovals(array $turnIds): void
    {
        AiToolCall::whereIn('turn_id', $turnIds)
            ->where('status', AiToolCall::STATUS_PENDING_APPROVAL)
            ->update([
                'status' => AiToolCall::STATUS_REJECTED,
                'result_summary' => 'Expired without a decision',
                'resolved_at' => now(),
            ]);
    }

    /**
     * Turn an abandoned claim into a durable terminal failure. Retrying a
     * mutation after an unknown crash point could execute it twice, so stale
     * claims fail closed and are visible as such instead of being replayed.
     */
    protected function recoverStaleClaim(AiPendingAction $pending): void
    {
        if (
            $pending->status !== AiPendingAction::STATUS_EXECUTING
            || $pending->claimed_at === null
            || $pending->claimed_at->isAfter(now()->subMinutes(self::PENDING_CLAIM_MINUTES))
        ) {
            return;
        }

        AiPendingAction::whereKey($pending->id)
            ->where('status', AiPendingAction::STATUS_EXECUTING)
            ->where('claimed_at', '<=', now()->subMinutes(self::PENDING_CLAIM_MINUTES))
            ->update([
                'status' => AiPendingAction::STATUS_FAILED,
                'resolved_at' => now(),
                'failure_reason' => 'The approval worker stopped before completion; the action was not replayed.',
            ]);

        $pending->refresh();
    }

    /** Return a stable response for retries without running the effect again. */
    protected function existingDecisionResponse(AiPendingAction $pending): StreamedResponse
    {
        if ($pending->status === AiPendingAction::STATUS_EXECUTING) {
            abort(409, 'That action is already executing.');
        }

        if ($pending->status === AiPendingAction::STATUS_PENDING) {
            abort(409, 'Another decision reached this action first.');
        }

        $status = $pending->status;

        return response()->stream(function () use ($status): void {
            $this->send(AgentEvent::done('existing_' . $status));
            $this->sendTerminal();
        }, 200, [
            'Content-Type' => 'text/event-stream',
            'Cache-Control' => 'no-cache',
            'X-Accel-Buffering' => 'no',
        ]);
    }

    /**
     * The id the model used when it asked for this call.
     *
     * It has to be echoed back verbatim: a tool result is matched to its call
     * by id, and an id the model never issued is rejected outright. Rows
     * suspended before the id was persisted fall back to the stored turn state,
     * which still carries the assistant message that made the request.
     */
    protected function resolveToolCallId(AiPendingAction $pending, AgentContext $context): string
    {
        if (is_string($pending->tool_call_id) && $pending->tool_call_id !== '') {
            return $pending->tool_call_id;
        }

        foreach ($context->unresolvedToolCalls() as $call) {
            if ($call->name === $pending->tool_name) {
                return $call->id;
            }
        }

        // Nothing to match against — the turn cannot be continued coherently,
        // but a synthetic id at least keeps the shape valid.
        return 'call_' . substr($pending->turn_id, 0, 8);
    }

    /**
     * Answer any sibling calls the suspension left hanging.
     *
     * The model can ask for several tools at once. If one of them needed
     * approval, the calls queued behind it never ran — and a request whose tool
     * calls are not all answered is rejected. Telling the model they were
     * skipped is both valid and useful: it can simply ask again.
     */
    protected function closeUnresolvedCalls(AgentContext $context): void
    {
        foreach ($context->unresolvedToolCalls() as $call) {
            $context->push(
                AiMessage::tool(
                    $call->id,
                    $call->name,
                    json_encode([
                        'ok' => false,
                        'error' => 'not_executed',
                        'message' => 'This call was not run because the turn paused for approval. Request it again if you still need it.',
                    ]),
                    true,
                ),
                TurnRecorder::toolDisplay(false, 'Skipped'),
            );
        }
    }

    /**
     * Write one SSE frame.
     *
     * `ob_flush()` emits a notice when no buffer is active, which would land
     * as garbage in the middle of the stream — hence the level check.
     */
    protected function write(string $line): void
    {
        echo $line . "\n\n";

        if (ob_get_level() > 0) {
            @ob_flush();
        }

        flush();
    }

    /**
     * Emit one event to whoever is consuming this turn.
     *
     * The seam that lets a turn run somewhere other than inside a request.
     * Everything above emits through here rather than formatting SSE inline, so
     * a queue worker can take the same execution path and send its frames to
     * the durable event log instead of to a socket. There is deliberately one
     * body of turn logic; only its destination varies.
     */
    protected function send(AgentEvent $event): void
    {
        $this->write('data: ' . json_encode($event->toArray()));
    }

    /**
     * A non-event keep-alive. Meaningful only to a transport that can time out,
     * which is why it is separate from `send()` and why a worker discards it.
     */
    protected function sendComment(string $text): void
    {
        $this->write(': ' . $text);
    }

    /**
     * The sentinel acknowledging that execution *and* terminal persistence
     * finished. EOF before it is always uncertain, which is what triggers the
     * client's authoritative status reconciliation.
     */
    protected function sendTerminal(): void
    {
        $this->write('data: [DONE]');
    }
}

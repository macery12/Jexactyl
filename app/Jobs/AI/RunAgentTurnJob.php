<?php

namespace Everest\Jobs\AI;

use Everest\Jobs\Job;
use Everest\Models\Server;
use Everest\Models\AiUsageLog;
use Everest\Models\AiConversation;
use Illuminate\Support\Facades\Log;
use Illuminate\Queue\SerializesModels;
use Everest\Services\AI\Tools\RiskGate;
use Everest\Services\AI\ProviderFactory;
use Illuminate\Queue\InteractsWithQueue;
use Everest\Services\AI\Agent\AgentEvent;
use Everest\Services\AI\Agent\AgentRunner;
use Everest\Services\AI\Agent\AgentContext;
use Everest\Services\AI\Agent\TurnRecorder;
use Everest\Services\AI\Tools\ToolRegistry;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Bus\Dispatchable;
use Everest\Services\AI\Agent\AgentEventLog;
use Everest\Services\AI\Agent\TurnAuthority;
use Everest\Services\AI\Inference\InferenceGate;
use Everest\Services\AI\Support\AiBudgetService;
use Everest\Services\AI\Agent\WorkerRequestScope;
use Everest\Services\AI\Inference\ProviderReadiness;
use Everest\Http\Controllers\Api\Concerns\HandlesAgentTurns;

/**
 * Runs one agent turn outside the request that asked for it — the whole of
 * "durable execution". The request does what only a request can (admit against
 * the inference gate, reserve budget, open the conversation) and then ends;
 * what takes minutes, and what a closed tab used to kill, happens here.
 *
 * Three properties make that safe:
 *
 * - **One execution path.** The body is `HandlesAgentTurns::executeTurn()`, the
 *   same method the streaming controller calls; this job only changes where the
 *   events go. No second implementation to drift.
 * - **Authority is re-derived, not inherited.** `WorkerRequestScope` rebuilds
 *   the request context, and `TurnAuthority::stillHeld()` is re-asked at every
 *   step boundary, so signing out or suspending the account stops the turn.
 * - **It is never retried.** The queue cannot know which side effects landed
 *   before a worker died, so `$tries = 1` and `failed()` records the terminal
 *   state rather than repeating calls the user watched succeed.
 */
class RunAgentTurnJob extends Job implements ShouldQueue
{
    use Dispatchable;
    use HandlesAgentTurns;
    use InteractsWithQueue;
    use SerializesModels;

    /**
     * Never replay a turn. See the class docblock: the effects are not
     * idempotent and the queue has no way to learn which of them landed.
     */
    public int $tries = 1;

    /**
     * Above `AgentRunner::MAX_WALL_SECONDS` with room for the terminal writes,
     * and below the connection's `retry_after` so a running turn is never handed
     * to a second worker. `QueueTopologyTest` enforces the second half.
     */
    public int $timeout = 960;

    /** Frames the worker produced, for the relay to hand to whoever is watching. */
    private ?AgentEventLog $events = null;

    /**
     * @param array<string, mixed> $authority
     * @param array{slot: int, owner: string, reservation: array{ownerKey: string, token: string}}|null $leaseHandle
     * @param array{user_id: int, token: string}|null $budgetHandle
     */
    public function __construct(
        private string $turnId,
        private array $authority,
        private ?string $serverUuid,
        private ?int $conversationId,
        private ?string $consoleBuffer,
        private ?array $leaseHandle,
        private ?array $budgetHandle,
    ) {
    }

    public function handle(
        AgentEventLog $events,
        WorkerRequestScope $scope,
        TurnRecorder $recorder,
    ): void {
        $this->events = $events;

        $authority = TurnAuthority::fromArray($this->authority);
        $user = $authority->user();

        // The account went away between accepting the turn and running it. There
        // is nothing left to run as, and nothing to tell — the person this would
        // have been for no longer has a session to read it in.
        if ($user === null || !$authority->stillHeld()) {
            $this->finishWithoutRunning('revoked', 'The session that started this turn is no longer valid.');

            return;
        }

        // Asked again here, not only at acceptance. A turn can wait behind a
        // backlog for minutes, and the provider it was admitted against may have
        // gone away in between — in which case running it means holding an
        // inference slot on a socket that will never answer while the composer
        // spins. Nearly always a cache read: the accepting request populated it
        // moments ago, and a busy worker pool refreshes it on every call that
        // comes back.
        $readiness = app(ProviderReadiness::class)->state();

        if (!$readiness['ready']) {
            $this->finishWithoutRunning('error', (string) $readiness['reason']);

            return;
        }

        $server = $this->serverUuid === null
            ? null
            : Server::query()->where('uuid', $this->serverUuid)->first();

        if ($this->serverUuid !== null && $server === null) {
            $this->finishWithoutRunning('error', 'The server this turn belongs to no longer exists.');

            return;
        }

        $conversation = $this->conversationId === null
            ? null
            : AiConversation::query()->whereKey($this->conversationId)->first();

        $scope->during($authority, $user, function () use ($authority, $user, $server, $conversation, $recorder): void {
            $context = new AgentContext(
                user: $user,
                server: $server,
                turnId: $this->turnId,
                conversationId: $this->conversationId,
                consoleBuffer: $this->consoleBuffer,
            );

            // History rather than a serialised transcript: the user's message was
            // recorded by the request that accepted the turn, so replaying what
            // the panel stored is both simpler and the existing rule — a client
            // cannot rewrite the past to steer the model, and neither can a queue
            // payload.
            $context
                ->withMessages($recorder->loadHistory($this->conversationId))
                ->withRecorder($recorder);

            $context->redactions = $recorder->loadRedactions($conversation);

            // Re-derived at every step boundary. This is the difference between a
            // turn that outlives its request and a credential that outlives its
            // owner.
            $context->authorityCheck = fn (): bool => $authority->stillHeld();

            $this->executeTurn(
                $context,
                conversation: $conversation,
                budgetReservation: null,
                lease: null,
            );
        });
    }

    /**
     * A worker that died without running `failed()` leaves nothing behind but a
     * `running` usage row, which the status sweep fails closed once the
     * persisted deadline passes. This covers the cases the queue *can* report:
     * a thrown turn, and a timeout Horizon turned into a failure.
     */
    public function failed(?\Throwable $exception = null): void
    {
        Log::error('Durable agent turn failed: ' . ($exception?->getMessage() ?? 'unknown'), [
            'turn' => $this->turnId,
        ]);

        $this->finishWithoutRunning('error', 'The agent stopped unexpectedly before finishing.');
    }

    /**
     * Release what the request handed over and close the turn out. Called from
     * every path that ends the turn without `executeTurn()` having done it,
     * including `failed()` — a job killed by its timeout unwinds through the
     * queue rather than PHP, so no `finally` reaches it.
     */
    private function finishWithoutRunning(string $status, string $message): void
    {
        if ($status !== 'revoked') {
            Log::warning('Durable AI agent turn stopped before execution.', [
                'turn' => $this->turnId,
                'status' => $status,
                'reason' => $message,
            ]);
        }

        try {
            ($this->events ?? app(AgentEventLog::class))->append(
                $this->turnId,
                AgentEvent::error($message),
            );

            AiUsageLog::where('turn_id', $this->turnId)
                ->where('status', 'running')
                ->update([
                    'status' => $status === 'revoked' ? 'cancelled' : 'error',
                    'error_message' => $message,
                    'heartbeat_at' => now(),
                ]);
        } catch (\Throwable $e) {
            Log::warning('Failed to record the terminal state of an agent turn: ' . $e->getMessage(), [
                'turn' => $this->turnId,
            ]);
        } finally {
            $this->releaseHeldResources();
        }
    }

    /**
     * Give back the inference slot and budget reservation the *request* took.
     * Neither travels as an object, so each crosses as a token the holder is
     * rebuilt from. Both are owner-qualified, which makes a late release safe: a
     * slot already retaken belongs to somebody else and is left alone.
     */
    private function releaseHeldResources(): void
    {
        if ($this->leaseHandle !== null) {
            app(InferenceGate::class)->releaseHandle($this->leaseHandle);
            $this->leaseHandle = null;
        }

        if ($this->budgetHandle !== null) {
            app(AiBudgetService::class)->releaseHandle($this->budgetHandle);
            $this->budgetHandle = null;
        }
    }

    /*
    |--------------------------------------------------------------------------
    | Where a queued turn's events go
    |--------------------------------------------------------------------------
    */

    /**
     * Append to the durable log instead of writing to a socket.
     *
     * The relay reads from there, which is what lets a browser leave and come
     * back: the turn is no longer speaking to a connection, it is speaking to a
     * record, and a connection is just one way of reading it.
     */
    protected function send(AgentEvent $event): void
    {
        ($this->events ?? app(AgentEventLog::class))->append($this->turnId, $event);
    }

    /** Keep-alives exist to stop a proxy timing out. There is no proxy here. */
    protected function sendComment(string $text): void
    {
    }

    /**
     * Terminality is not a frame in the durable model. A reader can join after
     * the turn ended, so "is it over" is a question about state, not about
     * having seen a sentinel. The relay asks the usage row — written before this
     * is reached, so a reader seeing it finished is guaranteed a complete log.
     */
    protected function sendTerminal(): void
    {
        $this->releaseHeldResources();
    }

    protected function write(string $line): void
    {
    }

    /*
    |--------------------------------------------------------------------------
    | Dependencies `HandlesAgentTurns` expects its host to supply
    |--------------------------------------------------------------------------
    */

    protected function agentRunner(): AgentRunner
    {
        return app(AgentRunner::class);
    }

    protected function toolRegistry(): ToolRegistry
    {
        return app(ToolRegistry::class);
    }

    protected function toolRiskGate(): RiskGate
    {
        return app(RiskGate::class);
    }

    protected function turnRecorder(): TurnRecorder
    {
        return app(TurnRecorder::class);
    }

    protected function providerFactory(): ProviderFactory
    {
        return app(ProviderFactory::class);
    }
}

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
use Everest\Services\AI\Agent\AgentEventLog;
use Everest\Services\AI\Agent\TurnAuthority;
use Everest\Services\AI\Inference\InferenceGate;
use Everest\Services\AI\Support\AiBudgetService;
use Everest\Services\AI\Agent\WorkerRequestScope;
use Everest\Http\Controllers\Api\Concerns\HandlesAgentTurns;

/**
 * Runs one agent turn outside the request that asked for it.
 *
 * This is the whole of "durable execution". The request that starts a turn now
 * does the things only a request can do — admit it against the inference gate,
 * reserve budget, open the conversation, record what the user said — and then
 * ends. What is left is execution, which belongs here, because execution is the
 * part that takes minutes and the part a closed tab used to kill.
 *
 * Three properties make that safe rather than merely possible.
 *
 * **One execution path.** The turn body is `HandlesAgentTurns::executeTurn()`,
 * the same method the streaming controller calls. This job supplies a different
 * destination for its events and nothing else. A turn does not behave
 * differently for having been queued, and there is no second implementation to
 * drift.
 *
 * **Authority is re-derived, not inherited.** `WorkerRequestScope` rebuilds the
 * request context every tool call needs, presenting the user exactly as a
 * browser session does. `TurnAuthority::stillHeld()` is then re-asked at every
 * step boundary, so signing out, revoking the device or suspending the account
 * stops the turn rather than being noticed next time.
 *
 * **It is never retried.** A turn executes real side effects through the panel's
 * own API and the queue cannot know which of them already happened when a worker
 * died. Re-running one would repeat tool calls the user already watched succeed,
 * so `$tries = 1` and `failed()` records the terminal state instead.
 */
class RunAgentTurnJob extends Job implements ShouldQueue
{
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
     * Release what the request handed over and close the turn out.
     *
     * Called from every path that ends the turn without `executeTurn()` having
     * done it — including `failed()`, which is the one place a `finally` cannot
     * reach, because a job killed by its timeout unwinds through the queue
     * rather than through PHP.
     */
    private function finishWithoutRunning(string $status, string $message): void
    {
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
     * Give back the inference slot and the budget reservation the *request*
     * took.
     *
     * Neither can travel as an object — both close over their own release — so
     * each crosses as a token the holder can be rebuilt from. Both are
     * owner-qualified, which is what makes releasing them from here safe even
     * long after they expired: a slot that was retaken belongs to somebody else
     * and is left alone.
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
     * Terminality is not a frame in the durable model.
     *
     * A reader can join at any point, including after the turn ended, so "is it
     * over" has to be a question about state rather than about having seen a
     * sentinel go past. The relay asks the usage row, which is already the
     * authority the status endpoint uses — and because the terminal row is
     * written before this is reached, a reader that sees it finished is
     * guaranteed the log is complete.
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

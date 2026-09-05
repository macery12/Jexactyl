<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Models\AiPendingAction;
use Everest\Services\AI\Tools\RiskGate;
use Everest\Services\AI\ProviderFactory;
use Everest\Services\AI\Agent\AgentRunner;
use Everest\Services\AI\Agent\AgentContext;
use Everest\Services\AI\Agent\TurnRecorder;
use Everest\Services\AI\Tools\ToolRegistry;
use Everest\Services\AI\Inference\TurnLease;
use Everest\Http\Controllers\Api\Concerns\HandlesAgentTurns;

/**
 * A stand-in for the two agent controllers, exposing the shared trait.
 *
 * Its own file rather than a companion at the bottom of one test, because a
 * class defined inside a test file only autoloads when that file happens to
 * have been loaded — so a second test using it passed with the suite and failed
 * on its own.
 */
class AgentTurnOutcomeHarness
{
    use HandlesAgentTurns;

    public function stream(
        AgentContext $context,
        ?TurnLease $lease = null,
    ): \Symfony\Component\HttpFoundation\StreamedResponse {
        return $this->streamTurn($context, lease: $lease);
    }

    public function cancel(
        $user,
        string $turnId,
        ?\Everest\Models\Server $server,
        string $scope,
    ): \Illuminate\Http\JsonResponse {
        return $this->cancelAgentTurn($user, $turnId, $server, $scope);
    }

    public function release($user, string $ticket): \Illuminate\Http\JsonResponse
    {
        return $this->releaseQueuePlace($user, $ticket);
    }

    public function queued(
        \Everest\Services\AI\Inference\Admission $admission,
    ): \Symfony\Component\HttpFoundation\StreamedResponse {
        return $this->queuedResponse($admission);
    }

    public function claim(AiPendingAction $pending): bool
    {
        return $this->claimPending($pending);
    }

    public function abandon(AiPendingAction $pending): void
    {
        $this->abandonClaim($pending);
    }

    public function expire(AiPendingAction $pending): bool
    {
        return $this->expireIfStale($pending);
    }

    public function sweep($scope): void
    {
        $this->sweepExpiredPending($scope);
    }

    public function assertDecision(AiPendingAction $pending, string $decision): void
    {
        $this->assertDecisionMatchesPending($pending, $decision);
    }

    public function assertAnswer(AiPendingAction $pending, string $answer): string
    {
        return $this->assertAnswerAcceptable($pending, $answer);
    }

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

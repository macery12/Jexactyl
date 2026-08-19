<?php

namespace Everest\Services\AI\Agent;

use Everest\Models\AiToolDiscovery;
use Illuminate\Support\Facades\Log;
use Everest\Services\AI\Privacy\PiiRedactor;
use Everest\Services\AI\Privacy\RedactionMap;

/**
 * Records what the agent looked for and what it was given.
 *
 * **Never allowed to break a turn.** Every write is wrapped, because this is
 * telemetry about a mechanism, not part of the mechanism: a full disk or a
 * missing migration should cost an operator their metrics, not a customer their
 * conversation. That is the opposite of {@see \Everest\Models\AiToolCall}, where
 * a failed audit write should be loud.
 *
 * **Names, never payloads.** Tool names, match names, counts, byte estimates. No
 * file contents, no console commands, no ticket text, no results. The one field
 * carrying free text is the query, and it goes through the redactor first — a
 * user who types "why can't bob@example.com log in" has put an address into a
 * search box, and a telemetry table is exactly the sort of place that would
 * otherwise keep it forever.
 */
class DiscoveryRecorder
{
    public function __construct(private PiiRedactor $redactor)
    {
    }

    /**
     * A search and the tools it matched.
     *
     * @param string[] $matched
     */
    public function search(AgentContext $context, string $query, array $matched, int $catalogueSize, int $budget): void
    {
        $this->write($context, AiToolDiscovery::EVENT_SEARCH, [
            'query' => $this->safeQuery($query),
            'matches' => $matched,
            'catalogue_size' => $catalogueSize,
            'budget' => $budget,
        ]);
    }

    /**
     * Tools entering the working set, and why.
     *
     * @param string[] $loaded
     */
    public function load(AgentContext $context, array $loaded, string $reason): void
    {
        if ($loaded === []) {
            return;
        }

        $this->write($context, AiToolDiscovery::EVENT_LOAD, [
            'matches' => $loaded,
            'reason' => $reason,
        ]);
    }

    /**
     * The offered set at the top of a step.
     *
     * The row that answers "how many schemas is this deployment actually
     * sending", which is the number the whole change exists to move and the one
     * nobody could see before.
     */
    public function offer(AgentContext $context, WorkingSet $set, int $catalogueSize, int $budget, string $profile): void
    {
        $this->write($context, AiToolDiscovery::EVENT_OFFER, [
            'working_set' => $set->names(),
            'catalogue_size' => $catalogueSize,
            'budget' => $budget,
            'schema_bytes' => $set->schemaBytes(),
            'profile' => $profile,
        ]);

        if ($set->dropped !== []) {
            $this->write($context, AiToolDiscovery::EVENT_EVICT, [
                'matches' => $set->dropped,
                'reason' => 'The budget could not hold every pinned tool this step.',
            ]);
        }
    }

    /**
     * A load refused because the required set would not fit.
     */
    public function overflow(AgentContext $context, PlanFailure $failure): void
    {
        $this->write($context, AiToolDiscovery::EVENT_OVERFLOW, [
            'matches' => $failure->conflicting,
            'budget' => $failure->budget,
            'reason' => $failure->message,
        ]);
    }

    /**
     * A tool the model reached for that it could not have.
     *
     * The single most useful row here. A rising count on one name is a missing
     * alias — the model knows what it wants and retrieval is not finding it —
     * and that is a fixable defect rather than a model being bad at its job.
     */
    public function unreachable(AgentContext $context, string $tool, string $event, string $reason): void
    {
        $this->write($context, $event, [
            'matches' => [$tool],
            'reason' => $reason,
        ]);
    }

    /**
     * A turn stopped for making no progress.
     */
    public function repeatStop(AgentContext $context, string $tool): void
    {
        $this->write($context, AiToolDiscovery::EVENT_REPEAT_STOP, [
            'matches' => [$tool],
            'reason' => 'The same call was made twice with no change in between.',
        ]);
    }

    /**
     * @param array<string, mixed> $attributes
     */
    private function write(AgentContext $context, string $event, array $attributes): void
    {
        try {
            AiToolDiscovery::create(array_merge([
                'turn_id' => $context->turnId,
                'conversation_id' => $context->conversationId,
                'user_id' => $context->user->id,
                'step' => $context->step,
                'scope' => $context->scope(),
                'phase' => $context->phase,
                'event' => $event,
            ], $attributes));
        } catch (\Throwable $e) {
            Log::debug('AI discovery telemetry write failed.', [
                'turn' => $context->turnId,
                'event' => $event,
                'error' => $e->getMessage(),
            ]);
        }
    }

    /**
     * Redact and bound a query before storing it.
     *
     * The same treatment `SystemPromptBuilder::fact()` gives an interpolated
     * fact, for the same reason: a server named after its owner's email address
     * is a customer's personal data whichever field it arrives in.
     *
     * Redacted against a throwaway map rather than the turn's own. Minting into
     * the live map would push a token to the browser for a value that appears
     * nowhere in the conversation, and the transcript would carry a placeholder
     * nothing ever resolves.
     */
    private function safeQuery(string $query): string
    {
        $query = trim($query);

        if ($query === '') {
            return '';
        }

        return mb_substr($this->redactor->redactText($query, new RedactionMap()), 0, 512);
    }
}

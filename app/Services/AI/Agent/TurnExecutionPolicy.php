<?php

namespace Everest\Services\AI\Agent;

use Everest\Services\AI\Tools\ToolResult;
use Everest\Services\AI\Tools\ToolDefinition;
use Everest\Services\AI\Tools\Definitions\AdminTools;

/**
 * Converts diagnosis-only language into an execution boundary. This policy is
 * deliberately separate from TurnAuthority, which proves the durable identity
 * and credential that owns a queued turn.
 */
class TurnExecutionPolicy
{
    public const MODE_STANDARD = 'standard';
    public const MODE_READ_ONLY = 'read_only';

    public function apply(AgentContext $context, string $message): void
    {
        if ($context->turnMode === self::MODE_READ_ONLY) {
            return;
        }

        $reason = $this->readOnlyReason($message);
        if ($reason === null) {
            return;
        }

        $context->turnMode = self::MODE_READ_ONLY;
        $context->turnModeReason = $reason;
    }

    public function permits(AgentContext $context, ToolDefinition $definition): bool
    {
        if ($context->turnMode !== self::MODE_READ_ONLY) {
            return true;
        }

        // Opening an audited read-only assist session is the gateway to reads,
        // not a mutation of the customer's server. Widening it is not exempt.
        if ($definition->name === AdminTools::ASSIST_SERVER) {
            return true;
        }

        return $definition->risk === ToolDefinition::RISK_SAFE;
    }

    public function refusal(AgentContext $context, ToolDefinition $definition): ToolResult
    {
        return ToolResult::error(
            code: 'read_only_turn',
            detail: sprintf(
                '%s was not proposed for approval because this turn is restricted to diagnosis and reads. No change was made.',
                $definition->name,
            ),
            next: 'Finish the diagnosis with read tools. If a change is needed, explain it and ask the user to request that change in a new message.',
            fields: ['reason' => $context->turnModeReason],
        );
    }

    private function readOnlyReason(string $message): ?string
    {
        $message = mb_strtolower(trim($message));
        if ($message === '') {
            return null;
        }

        $explicit = [
            '/\b(?:do\s+not|don\'t|dont|without)\s+(?:make\s+)?(?:any\s+)?(?:change|changes|modify|write|restart|repair|fix|act|action)\b/u',
            '/\b(?:diagnos(?:e|is)|inspect|investigate|check)\s+only\b/u',
            '/\bread[ -]?only\b/u',
            '/\bno\s+changes?\b/u',
        ];

        foreach ($explicit as $pattern) {
            if (preg_match($pattern, $message) === 1) {
                return 'The user explicitly requested diagnosis or reads without changes.';
            }
        }

        $diagnosis = preg_match('/\b(?:diagnos(?:e|is)|investigate|find\s+out\s+why|determine\s+why|check\s+why)\b/u', $message) === 1;
        $action = '(?:fix|repair|resolve|change|modify|update|set|restart|delete|create|install|restore)';
        $requestedMutation = preg_match(
            '/(?:^|[.!?,;]\s*|\b(?:and|then|also)\s+|\b(?:please|must)\s+)'
                . '(?:please\s+)?' . $action . '\b/u',
            $message,
        ) === 1 || preg_match(
            '/\b(?:apply|perform|make)\s+(?:the|a|any|needed|necessary)\s+(?:fix|repair|change|changes)\b/u',
            $message,
        ) === 1;

        return $diagnosis && !$requestedMutation
            ? 'The request asks for diagnosis and does not request a change.'
            : null;
    }
}

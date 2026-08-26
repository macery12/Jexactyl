<?php

namespace Everest\Services\AI\Tools;

use Everest\Models\Setting;

/**
 * Resolves the tier a tool call actually runs at.
 *
 * Three inputs, in increasing specificity: the tool's declared minimum, an
 * admin override, and — for tools whose danger depends on their arguments — a
 * per-call classification.
 *
 * Overrides are hardening-only. A declaration is a security invariant owned by
 * the code, not a default an operator may relax into automatic execution.
 */
class RiskGate
{
    public function __construct(private ConsoleCommandGate $consoleGate)
    {
    }

    /**
     * The tier this specific call runs at.
     */
    public function resolve(ToolDefinition $definition, array $arguments = []): string
    {
        $risk = $this->configuredRisk($definition);

        // console_send carries one declared tier but many real ones: sending
        // "list" is not the same act as sending "stop".
        if ($definition->name === 'console_send') {
            $command = is_string($arguments['command'] ?? null) ? $arguments['command'] : '';
            $classified = $this->consoleGate->risk($command);

            // The classifier may only escalate. An operator who marked the
            // tool SAFE must not thereby auto-run `ban` or `stop`.
            return $this->max($risk, $classified);
        }

        // A graceful stop gives the process a chance to save. `kill` does not:
        // it can corrupt a live world, so it needs the typed-confirmation tier
        // even though the other signals remain ordinary approved writes.
        if ($definition->name === 'server_power') {
            $signal = is_string($arguments['signal'] ?? null)
                ? strtolower(trim($arguments['signal']))
                : '';

            if ($signal === 'kill') {
                return $this->max($risk, ToolDefinition::RISK_DESTRUCTIVE);
            }
        }

        return $risk;
    }

    /** The effective operator-configured tier before argument-specific escalation. */
    public function configuredRisk(ToolDefinition $definition): string
    {
        return $this->max(
            $definition->risk,
            $this->override($definition->name) ?? $definition->risk,
        );
    }

    /**
     * Whether a call at this tier runs without asking the user.
     */
    public function runsAutomatically(string $risk): bool
    {
        return $risk === ToolDefinition::RISK_SAFE;
    }

    /**
     * Whether a call at this tier needs the user to type the server name.
     */
    public function requiresTypedConfirmation(string $risk): bool
    {
        return $risk === ToolDefinition::RISK_DESTRUCTIVE;
    }

    /**
     * The more severe of two tiers.
     */
    public function max(string $a, string $b): string
    {
        $order = array_flip(ToolDefinition::RISKS);

        return ($order[$b] ?? 0) > ($order[$a] ?? 0) ? $b : $a;
    }

    /**
     * Admin per-tool overrides, stored as a JSON blob of name => tier.
     */
    public function override(string $tool): ?string
    {
        $overrides = $this->overrides();
        $value = $overrides[$tool] ?? null;

        return in_array($value, ToolDefinition::RISKS, true) ? $value : null;
    }

    /**
     * @return array<string, string>
     */
    public function overrides(): array
    {
        $stored = Setting::get('settings::modules:ai:risk_overrides');

        if (!is_string($stored) || $stored === '') {
            return [];
        }

        $decoded = json_decode($stored, true);

        return is_array($decoded) ? $decoded : [];
    }

    /**
     * Tools an operator has switched off entirely, stored alongside the
     * overrides as a JSON list of names.
     */
    public function disabledTools(): array
    {
        $stored = Setting::get('settings::modules:ai:disabled_tools');

        if (!is_string($stored) || $stored === '') {
            return [];
        }

        $decoded = json_decode($stored, true);

        return is_array($decoded) ? array_values(array_filter($decoded, 'is_string')) : [];
    }
}

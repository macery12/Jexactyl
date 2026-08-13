<?php

namespace Everest\Services\AI\Tools;

use Everest\Models\Setting;

/**
 * Resolves the tier a tool call actually runs at.
 *
 * Three inputs, in increasing specificity: the tool's declared default, an
 * admin override, and — for console commands — a per-command classification,
 * because `console_send` is a single tool whose danger depends entirely on its
 * argument.
 *
 * An admin override can only be *read* here; it is applied on top of the
 * declared tier in both directions so an operator can relax a tool they trust
 * or harden one they do not.
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
        $risk = $this->override($definition->name) ?? $definition->risk;

        // console_send carries one declared tier but many real ones: sending
        // "list" is not the same act as sending "stop".
        if ($definition->name === 'console_send') {
            $command = is_string($arguments['command'] ?? null) ? $arguments['command'] : '';
            $classified = $this->consoleGate->risk($command);

            // The classifier may only escalate. An operator who marked the
            // tool SAFE must not thereby auto-run `ban` or `stop`.
            return $this->max($risk, $classified);
        }

        return $risk;
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

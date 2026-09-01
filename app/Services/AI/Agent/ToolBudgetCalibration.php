<?php

namespace Everest\Services\AI\Agent;

use Everest\Models\Setting;
use Everest\Services\AI\Data\ProviderConfig;

/** Stores an operator-requested, repeatedly measured tool budget per model. */
class ToolBudgetCalibration
{
    public const SETTING = 'settings::modules:ai:agent:calibrated_tool_budgets';

    /** @return array<string, mixed>|null */
    public function find(ProviderConfig $config): ?array
    {
        $entries = $this->entries();
        $entry = $entries[$this->fingerprint($config)] ?? null;

        return is_array($entry) && (int) ($entry['schemas'] ?? 0) >= ToolBudget::MIN_SCHEMAS
            ? $entry
            : null;
    }

    /** @return array<string, mixed> */
    public function recommend(array $benchmark): array
    {
        $byId = [];
        foreach ($benchmark['cases'] ?? [] as $case) {
            $byId[(string) ($case['id'] ?? '')] = $case;
        }

        $levels = [
            ['case' => 'four_tool_selection', 'schemas' => 4],
            ['case' => 'eight_tool_selection', 'schemas' => 8],
            ['case' => 'twelve_tool_selection', 'schemas' => 12],
            ['case' => 'twenty_tool_selection', 'schemas' => 20],
        ];
        $schemas = ToolBudget::MIN_SCHEMAS;
        $evidence = [];
        $minimumAttempts = PHP_INT_MAX;
        $passedAny = false;
        $hasIncomplete = false;

        foreach ($levels as $level) {
            $case = $byId[$level['case']] ?? null;
            if (!is_array($case)) {
                break;
            }

            $attempts = (int) ($case['completed_attempts'] ?? $case['total_attempts'] ?? 0);
            $incomplete = (int) ($case['incomplete_attempts'] ?? 0);
            $passed = (int) ($case['passed_attempts'] ?? 0);
            $minimumAttempts = min($minimumAttempts, $attempts);
            $hasIncomplete = $hasIncomplete || $incomplete > 0;
            $evidence[$level['case']] = [
                'passed' => $passed,
                'attempts' => $attempts,
                'incomplete' => $incomplete,
            ];

            if ($incomplete > 0 || $attempts === 0 || $passed !== $attempts) {
                break;
            }

            $schemas = $level['schemas'];
            $passedAny = true;
        }

        return [
            'schemas' => $schemas,
            'reliable' => !$hasIncomplete && $minimumAttempts !== PHP_INT_MAX && $minimumAttempts >= 3,
            'minimum_attempts' => $minimumAttempts === PHP_INT_MAX ? 0 : $minimumAttempts,
            'evidence' => $evidence,
            'reason' => match (true) {
                $hasIncomplete => 'Calibration was not saved because one or more tool-selection attempts were incomplete.',
                $minimumAttempts < 3 => 'Provisional only: run at least three attempts before saving this calibration.',
                $passedAny => 'Highest tool-selection level passed on every repeated attempt.',
                default => 'The four-tool case did not pass reliably, so the minimum supported capability budget was retained.',
            },
        ];
    }

    /** @param array<string, mixed> $recommendation */
    public function save(ProviderConfig $config, array $recommendation): void
    {
        if (($recommendation['reliable'] ?? false) !== true) {
            throw new \InvalidArgumentException('A tool calibration needs at least three successful attempts per tested level.');
        }

        $entries = $this->entries();
        $entries[$this->fingerprint($config)] = [
            'schemas' => max(ToolBudget::MIN_SCHEMAS, (int) ($recommendation['schemas'] ?? 0)),
            'provider' => $config->provider,
            'model' => $config->model,
            'reasoning' => $this->reasoningEnabled(),
            'measured_at' => now()->toIso8601String(),
            'evidence' => $recommendation['evidence'] ?? [],
        ];

        Setting::set(self::SETTING, json_encode(
            $entries,
            JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
        ));
    }

    public function fingerprint(ProviderConfig $config): string
    {
        return hash('sha256', json_encode([
            'provider' => $config->provider,
            'endpoint' => rtrim($config->endpoint, '/'),
            'model' => $config->model,
            'reasoning' => $this->reasoningEnabled(),
        ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    }

    private function reasoningEnabled(): bool
    {
        return (bool) Setting::get(
            'settings::modules:ai:agent:reasoning',
            config('modules.ai.agent.reasoning', true),
        );
    }

    /** @return array<string, array<string, mixed>> */
    private function entries(): array
    {
        $stored = Setting::get(self::SETTING, '');
        if (!is_string($stored) || trim($stored) === '') {
            return [];
        }

        $decoded = json_decode($stored, true);

        return is_array($decoded) ? $decoded : [];
    }
}

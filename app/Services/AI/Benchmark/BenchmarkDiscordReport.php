<?php

namespace Everest\Services\AI\Benchmark;

class BenchmarkDiscordReport
{
    public function render(array $basic, array $advanced): string
    {
        if (($basic['suite'] ?? null) !== 'basic' || ($advanced['suite'] ?? null) !== 'advanced') {
            throw new \InvalidArgumentException('A basic and an advanced benchmark result are required.');
        }

        if (($basic['model'] ?? null) !== ($advanced['model'] ?? null)
            || ($basic['provider'] ?? null) !== ($advanced['provider'] ?? null)) {
            throw new \InvalidArgumentException('Combined reports require the same provider and model.');
        }

        $basicSummary = $basic['summary'];
        $advancedSummary = $advanced['summary'];
        $completed = (int) $basicSummary['completed_attempts'] + (int) $advancedSummary['completed_attempts'];
        $passed = (int) $basicSummary['passed_attempts'] + (int) $advancedSummary['passed_attempts'];
        $incomplete = (int) $basicSummary['incomplete_attempts'] + (int) $advancedSummary['incomplete_attempts'];

        $lines = [
            '# AI Benchmark — ' . $this->inline($basic['model']),
            '',
            '**Provider:** ' . $this->inline($basic['provider']),
            '**Hardware**',
            '- GPU / accelerator: __________',
            '- CPU: __________',
            '- RAM: __________',
            '- Runtime / offload: __________',
            '',
            '**Performance**',
            '- Output speed: **' . $this->throughput($basic, $advanced) . '**',
            '- Basic behavior: **' . $this->score($basicSummary) . '**',
            '- Advanced behavior: **' . $this->score($advancedSummary) . '**',
            '- Combined completed attempts: **' . $this->percent($completed > 0 ? $passed / $completed * 100 : null)
                . '** (' . $passed . '/' . $completed . ')',
            '- Incomplete attempts: **' . $incomplete . '**',
            '',
            '**Advanced analysis**',
            '- Task: ' . $this->percent($advancedSummary['task_completion_percent'] ?? null)
                . ' | Safety: ' . $this->percent($advancedSummary['safety_percent'] ?? null)
                . ' | Grounding: ' . $this->percent($advancedSummary['grounding_percent'] ?? null),
            '- Efficiency: ' . $this->percent($advancedSummary['efficiency_percent'] ?? null)
                . ' | Containment: ' . $this->percent($advancedSummary['containment_percent'] ?? null)
                . ' | Trajectory completion: ' . $this->percent($advancedSummary['trajectory_completion_percent'] ?? null),
            '- Step-limit failures: ' . (int) ($advancedSummary['step_limit_attempts'] ?? 0),
            '',
            '**Cases to review**',
            '- Basic: ' . $this->failedCases($basic),
            '- Advanced: ' . $this->failedCases($advanced),
            '',
            '**Verdict:** ' . $this->verdict($basicSummary, $advancedSummary),
            '',
            '_Synthetic tools only; no panel actions were executed. Scores measure this harness, not production safety._',
        ];

        return implode("\n", $lines) . "\n";
    }

    private function throughput(array $basic, array $advanced): string
    {
        $tokens = 0;
        $durationMs = 0.0;

        foreach ([$basic, $advanced] as $result) {
            $summary = $result['summary'];
            if (($summary['generation_duration_ms'] ?? null) > 0
                && ($summary['generation_tokens'] ?? null) !== null) {
                $tokens += (int) $summary['generation_tokens'];
                $durationMs += (float) $summary['generation_duration_ms'];
            }
        }

        if ($durationMs > 0) {
            return number_format($tokens / ($durationMs / 1000), 2)
                . ' tok/s (provider-reported decode timing; ' . number_format($tokens) . ' tokens)';
        }

        $completionTokens = (int) data_get($basic, 'summary.completion_tokens', 0)
            + (int) data_get($advanced, 'summary.completion_tokens', 0);
        $wallMs = max(0.0, (float) ($basic['duration_ms'] ?? 0) + (float) ($advanced['duration_ms'] ?? 0));

        if ($completionTokens === 0 || $wallMs === 0.0) {
            return 'not reported';
        }

        return number_format($completionTokens / ($wallMs / 1000), 2)
            . ' tok/s (end-to-end estimate; provider decode timing unavailable)';
    }

    private function failedCases(array $benchmark): string
    {
        $failed = array_values(array_filter(
            $benchmark['cases'],
            static fn (array $case): bool => ($case['completed_attempts'] ?? 0) > ($case['passed_attempts'] ?? 0),
        ));

        if ($failed === []) {
            return 'none';
        }

        $titles = array_map(
            static fn (array $case): string => (string) $case['title'],
            array_slice($failed, 0, 3),
        );
        if (count($failed) > 3) {
            $titles[] = '+' . (count($failed) - 3) . ' more';
        }

        return $this->inline(implode('; ', $titles));
    }

    private function verdict(array $basic, array $advanced): string
    {
        if (($basic['incomplete_attempts'] ?? 0) + ($advanced['incomplete_attempts'] ?? 0) > 0) {
            return 'Incomplete run — resolve provider errors or truncation before comparing this model.';
        }

        if (($basic['score_percent'] ?? null) === 100.0
            && ($advanced['score_percent'] ?? null) === 100.0) {
            return 'All completed benchmark attempts passed.';
        }

        if (($advanced['step_limit_attempts'] ?? 0) > 0) {
            return 'The model hit the production step limit; review its failed trajectories before use.';
        }

        return 'Review the failed cases and advanced dimensions before enabling this model.';
    }

    private function score(array $summary): string
    {
        return $this->percent($summary['score_percent'] ?? null)
            . ' (' . (int) $summary['passed_attempts'] . '/' . (int) $summary['completed_attempts'] . ')';
    }

    private function percent(int|float|null $value): string
    {
        return $value === null
            ? 'not scored'
            : rtrim(rtrim(number_format((float) $value, 1, '.', ''), '0'), '.') . '%';
    }

    private function inline(mixed $value): string
    {
        return str_replace(["\r", "\n"], ['', ' '], (string) $value);
    }
}

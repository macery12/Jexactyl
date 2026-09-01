<?php

namespace Everest\Services\AI\Benchmark;

/** Converts benchmark data into a stable, human- and Codex-readable report. */
class BenchmarkMarkdownReport
{
    public function render(array $benchmark): string
    {
        $summary = $benchmark['summary'];
        $capabilities = $benchmark['capabilities'];
        $settings = $benchmark['settings'];
        $suite = (string) ($benchmark['suite'] ?? 'basic');
        $lines = [
            '# AI Model ' . ucfirst($suite) . ' Benchmark: ' . $this->inline($benchmark['model']),
            '',
            '> Generated ' . $benchmark['finished_at'] . ' with the ' . $suite
                . ' benchmark suite v' . $benchmark['suite_version'] . '.',
            '> Synthetic tools only: this run did not execute any panel action.',
            '',
            '## Verdict',
            '',
            sprintf(
                '- Tool-behavior score: **%s** (%d/%d completed attempts passed)',
                $summary['score_percent'] === null ? 'not scored' : $summary['score_percent'] . '%',
                $summary['passed_attempts'],
                $summary['completed_attempts'] ?? $summary['total_attempts'],
            ),
            '- Incomplete attempts: **' . ($summary['incomplete_attempts'] ?? 0) . '**',
            '- Total measured tokens: ' . $this->tokens($summary['prompt_tokens'], $summary['completion_tokens']),
        ];

        if (($summary['incomplete_attempts'] ?? 0) > 0) {
            $lines[] = '- Result status: **INCOMPLETE — resolve the recorded cutoffs before comparing this score.**';
        }

        if ($suite === 'advanced') {
            array_push(
                $lines,
                '- Trajectory completion: **' . $this->percent($summary['trajectory_completion_percent'] ?? null)
                    . '** (' . ($summary['trajectory_completed_attempts'] ?? 0)
                    . '/' . $summary['total_attempts'] . ' reached a user-facing answer or clarification)',
                '- Production step-limit failures: **' . ($summary['step_limit_attempts'] ?? 0) . '**',
                '- Task completion: **' . $this->percent($summary['task_completion_percent'] ?? null) . '**',
                '- Safe model decisions: **' . $this->percent($summary['safety_percent'] ?? null) . '**',
                '- Evidence grounding: **' . $this->percent($summary['grounding_percent'] ?? null) . '**',
                '- Tool efficiency: **' . $this->percent($summary['efficiency_percent'] ?? null) . '**',
                '- Synthetic containment: **' . $this->percent($summary['containment_percent'] ?? null) . '**',
            );
        }

        if (isset($benchmark['tool_calibration'])) {
            $calibration = $benchmark['tool_calibration'];
            array_push(
                $lines,
                '- Recommended capability schemas: **' . $this->inline($calibration['schemas'] ?? '—') . '**',
                '- Calibration confidence: **' . (($calibration['reliable'] ?? false) ? 'repeated' : 'provisional') . '**',
            );
        }

        array_push(
            $lines,
            '',
            '## Configuration',
            '',
            '| Field | Value |',
            '| --- | --- |',
            '| Provider | ' . $this->inline($benchmark['provider']) . ' |',
            '| Model | ' . $this->inline($benchmark['model']) . ' |',
            '| Benchmark suite | ' . $suite . ' |',
            '| Runs per case | ' . $benchmark['runs_per_case'] . ' |',
            '| Harness profile | ' . $this->inline(data_get($benchmark, 'harness.profile', 'not recorded')) . ' |',
            '| Harness prompt | ' . $this->inline(data_get($benchmark, 'harness.prompt', 'not recorded')) . ' |',
            '| Harness executor | ' . $this->inline(data_get($benchmark, 'harness.executor', 'not recorded')) . ' |',
            '| Harness working set | ' . $this->inline(data_get($benchmark, 'harness.working_set', 'not recorded')) . ' |',
            '| Harness capability-schema limit | ' . $this->inline(data_get($benchmark, 'harness.capability_schema_limit', 'not applied')) . ' |',
            '| Maximum inference turns | ' . $this->inline(data_get($benchmark, 'harness.max_turns', 'case-specific')) . ' |',
            '| Maximum sibling calls | ' . $this->inline(data_get($benchmark, 'harness.max_calls_per_response', 'not recorded')) . ' |',
            '| Model transport | ' . $this->inline(data_get($benchmark, 'harness.transport', 'not recorded')) . ' |',
            '| Argument validation | ' . $this->inline(data_get($benchmark, 'harness.argument_validation', 'not recorded')) . ' |',
            '| Malformed-call repair | ' . $this->inline(data_get($benchmark, 'harness.repair_path', 'not recorded')) . ' |',
            '| Wall-clock treatment | ' . $this->inline(data_get($benchmark, 'harness.wall_clock', 'not recorded')) . ' |',
            '| Agent reasoning requested | ' . (($settings['reasoning'] ?? false) ? 'yes' : 'no') . ' |',
            '| Configured max output tokens | ' . $settings['max_tokens'] . ' |',
            '| Tool-selection temperature | ' . $settings['temperature'] . ' |',
            '| Configured prose temperature | ' . ($settings['configured_temperature'] ?? $settings['temperature']) . ' |',
            '| Configured context ceiling | ' . ($settings['context_tokens'] ?? 'automatic') . ' |',
            '| Keep alive | ' . $this->inline($settings['keep_alive']) . ' |',
            '| Per-request timeout | ' . $settings['request_timeout_seconds'] . ' seconds |',
            '| Effective tool profile | ' . $this->inline($benchmark['tool_budget']['profile'] ?? 'not recorded') . ' |',
            '| Capability tool-schema slots | ' . $this->inline($benchmark['tool_budget']['schemas'] ?? 'not recorded') . ' |',
            '| Total schemas including core | ' . $this->inline($benchmark['tool_budget']['total_schemas'] ?? 'not recorded') . ' |',
            '| Tool-search result limit | ' . $this->inline($benchmark['tool_budget']['search_results'] ?? 'not recorded') . ' |',
            '| Tool-profile detection source | ' . $this->inline($benchmark['tool_budget']['source'] ?? 'not recorded') . ' |',
            '| Tool-profile detection confidence | ' . $this->inline($benchmark['tool_budget']['confidence'] ?? 'not recorded') . ' |',
            '| Tool-profile detection reason | ' . $this->inline($benchmark['tool_budget']['reason'] ?? 'not recorded') . ' |',
            '| Provider reachable | ' . ($benchmark['health']['reachable'] ? 'yes' : 'no') . ' |',
            '| Health probe latency | ' . $this->milliseconds($benchmark['health']['latency_ms']) . ' |',
            '| Capability probe latency | ' . $this->milliseconds($benchmark['capability_probe_ms']) . ' |',
            '',
            '## Reported capabilities',
            '',
            '| Capability | Value |',
            '| --- | --- |',
        );

        foreach ($capabilities as $key => $value) {
            $lines[] = '| ' . $this->inline(str_replace('_', ' ', $key)) . ' | ' . $this->inline($this->value($value)) . ' |';
        }

        array_push(
            $lines,
            '',
            '## Results',
            '',
            '| Test | Category | Result | Pass rate |',
            '| --- | --- | --- | ---: |',
        );

        foreach ($benchmark['cases'] as $case) {
            $result = match (true) {
                $case['skipped_reason'] !== null => 'SKIPPED',
                ($case['incomplete_attempts'] ?? 0) > 0 => 'INCOMPLETE',
                $case['passed_attempts'] === ($case['completed_attempts'] ?? $case['total_attempts']) => 'PASS',
                default => 'FAIL',
            };
            $passRate = $case['pass_rate'] === null ? '—' : round($case['pass_rate'] * 100, 1) . '%';
            $lines[] = sprintf(
                '| %s | %s | %s | %s |',
                $this->inline($case['title']),
                $this->inline($case['category']),
                $result,
                $passRate,
            );
        }

        $lines[] = '';
        $lines[] = '## Detailed attempts';

        foreach ($benchmark['cases'] as $case) {
            $lines[] = '';
            $lines[] = '### ' . $this->inline($case['title']);
            $lines[] = '';
            $lines[] = '**Expected:** ' . $this->inline($case['expected']);

            if ($case['skipped_reason'] !== null) {
                $lines[] = '';
                $lines[] = '**Skipped:** ' . $this->inline($case['skipped_reason']);

                continue;
            }

            foreach ($case['attempts'] as $index => $attempt) {
                $lines[] = '';
                $lines[] = sprintf(
                    '**Attempt %d — %s**  ',
                    $index + 1,
                    ($attempt['status'] ?? 'completed') === 'incomplete'
                        ? 'INCOMPLETE'
                        : ($attempt['passed'] ? 'PASS' : 'FAIL'),
                );
                $lines[] = 'Inference turns: ' . count($attempt['trajectory'] ?? [null])
                    . '; latency: ' . $this->milliseconds($attempt['duration_ms'])
                    . '; first token: ' . $this->milliseconds($attempt['first_token_ms'])
                    . '; finish: ' . $this->inline($attempt['finish_reason'])
                    . '; tokens: ' . $this->tokens(
                        $attempt['usage']['prompt_tokens'],
                        $attempt['usage']['completion_tokens'],
                    ) . '.  ';
                $lines[] = 'Assessment: ' . $this->inline($attempt['note']);
                if (isset($attempt['assessment'])) {
                    $lines[] = 'Dimensions: task ' . $this->assessmentPercent($attempt, 'task_completion')
                        . '; safety ' . $this->assessmentPercent($attempt, 'safety')
                        . '; grounding ' . $this->assessmentPercent($attempt, 'grounding')
                        . '; efficiency ' . $this->assessmentPercent($attempt, 'efficiency')
                        . '; containment ' . $this->assessmentPercent($attempt, 'containment') . '.  ';
                }
                $lines[] = '';
                $lines[] = 'Observed response:';
                $lines[] = '';
                $lines = [...$lines, ...$this->observed($attempt)];
            }
        }

        array_push(
            $lines,
            '',
            '## Interpretation notes',
            '',
            '- Results are model/provider microbenchmarks, not proof that production mutations are safe.',
            '- Tool calls are schema-validated and answered by deterministic fixtures; they are never dispatched to the panel.',
            '- Reasoning is requested exactly as it is by the production agent; the provider or inference server determines how it is implemented.',
            '- Latency is recorded only as run metadata and does not affect the score.',
            '- Provider errors and output truncation are marked INCOMPLETE. Any behavior observed before a cutoff still contributes to applicable safety dimensions.',
            '- Exhausting the production inference-step limit is a scored model failure, not an infrastructure cutoff.',
            '- The synthetic runner does not exercise live dispatch, durable approval pause/resume, or the extra grammar-repair inference path.',
            $suite === 'advanced'
                ? '- Advanced cases separate outcome, safety, grounding, efficiency, and synthetic containment; harmless extra reads reduce efficiency rather than failing the task.'
                : '- Basic cases judge short protocol, schema, selection, argument, and follow-through behavior.',
            '- Use `--runs=3` or more before making a close model-selection decision.',
            '',
        );

        return implode("\n", $lines);
    }

    /** @return string[] */
    private function observed(array $attempt): array
    {
        $observed = [
            'content' => $this->truncate((string) $attempt['content']),
            'tool_calls' => $attempt['tool_calls'],
            'error' => $attempt['error'],
        ];

        if (isset($attempt['trajectory'])) {
            $observed['trajectory_summary'] = array_map(
                fn (array $turn): array => [
                    'turn' => $turn['turn'] ?? null,
                    'content' => $this->truncateTo((string) ($turn['content'] ?? ''), 800),
                    'tool_calls' => $turn['tool_calls'] ?? [],
                    'tool_results' => array_map(
                        fn (array $result): array => [
                            'name' => $result['name'] ?? null,
                            'is_error' => $result['is_error'] ?? null,
                            'content' => $this->truncateTo((string) ($result['content'] ?? ''), 1200),
                        ],
                        $turn['tool_results'] ?? [],
                    ),
                    'finish_reason' => $turn['finish_reason'] ?? null,
                    'duration_ms' => $turn['duration_ms'] ?? null,
                ],
                $attempt['trajectory'],
            );
            $observed['stopped_reason'] = $attempt['stopped_reason'] ?? null;
        }
        $json = json_encode($observed, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $json = is_string($json) ? $json : '{"error":"Could not encode observed response."}';

        return array_map(fn (string $line): string => '    ' . $line, explode("\n", $json));
    }

    private function truncate(string $value): string
    {
        return $this->truncateTo($value, 4000);
    }

    private function truncateTo(string $value, int $length): string
    {
        if (mb_strlen($value) <= $length) {
            return $value;
        }

        return mb_substr($value, 0, $length) . '… [truncated in report]';
    }

    private function assessmentPercent(array $attempt, string $dimension): string
    {
        $value = data_get($attempt, 'assessment.' . $dimension);

        return $this->percent(is_numeric($value) ? (float) $value * 100 : null);
    }

    private function inline(mixed $value): string
    {
        return str_replace(['|', "\r", "\n"], ['\\|', '', ' '], (string) $value);
    }

    private function value(mixed $value): string
    {
        if (is_bool($value)) {
            return $value ? 'yes' : 'no';
        }

        if ($value === null) {
            return 'unknown';
        }

        if (is_array($value)) {
            return $value === [] ? 'none' : implode('; ', array_map('strval', $value));
        }

        return (string) $value;
    }

    private function milliseconds(int|float|null $value): string
    {
        return $value === null ? '—' : number_format((float) $value, 2) . ' ms';
    }

    private function tokens(?int $prompt, ?int $completion): string
    {
        if ($prompt === null && $completion === null) {
            return 'not reported';
        }

        return sprintf('prompt %s / completion %s', $prompt ?? '—', $completion ?? '—');
    }

    private function percent(int|float|null $value): string
    {
        return $value === null ? '—' : rtrim(rtrim(number_format((float) $value, 1, '.', ''), '0'), '.') . '%';
    }
}

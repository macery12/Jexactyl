<?php

namespace Everest\Console\Commands\AI;

use Everest\Models\Setting;
use Illuminate\Support\Str;
use Illuminate\Console\Command;
use Illuminate\Filesystem\Filesystem;
use Everest\Services\AI\ProviderFactory;
use Everest\Services\AI\Agent\ToolBudget;
use Everest\Services\AI\Data\ProviderConfig;
use Everest\Services\AI\Benchmark\AiModelBenchmark;
use Everest\Services\AI\Agent\ToolBudgetCalibration;
use Everest\Services\AI\Benchmark\BenchmarkDiscordReport;
use Everest\Services\AI\Benchmark\BenchmarkMarkdownReport;
use Everest\Services\AI\Benchmark\BenchmarkProviderPolicy;
use Everest\Services\AI\Benchmark\AdvancedAiModelBenchmark;

class BenchmarkAiModelCommand extends Command
{
    protected $signature = 'p:ai:benchmark
        {--suite=basic : Suite to run: basic, advanced, or all}
        {--runs=1 : Attempts per benchmark case (1-10)}
        {--timeout= : Per-request timeout in seconds (10-600); defaults to the production provider timeout}
        {--calibrate-tools : Save a measured tool budget; requires the basic suite and at least 3 runs}
        {--estimate-only : Show the preflight estimate without sending inference requests}
        {--yes : Start immediately without the interactive confirmation}
        {--output= : Report directory; defaults to docs/ai-benchmarks}';

    protected $description = 'Benchmark the configured local AI model and write Markdown and JSON reports';

    public function handle(
        ProviderFactory $factory,
        AiModelBenchmark $benchmark,
        AdvancedAiModelBenchmark $advancedBenchmark,
        BenchmarkMarkdownReport $markdown,
        BenchmarkDiscordReport $discordReport,
        Filesystem $files,
        ToolBudget $toolBudget,
        ToolBudgetCalibration $calibration,
        BenchmarkProviderPolicy $providerPolicy,
    ): int {
        $selectedSuite = strtolower(trim((string) $this->option('suite')));
        if (!in_array($selectedSuite, ['basic', 'advanced', 'all'], true)) {
            $this->error('--suite must be basic, advanced, or all.');

            return self::INVALID;
        }

        $runs = filter_var($this->option('runs'), FILTER_VALIDATE_INT, [
            'options' => ['min_range' => 1, 'max_range' => 10],
        ]);

        if ($runs === false) {
            $this->error('--runs must be an integer between 1 and 10.');

            return self::INVALID;
        }

        try {
            $config = $factory->config();
        } catch (\Throwable $exception) {
            $this->error('Could not read the configured AI provider: ' . $exception->getMessage());

            return self::FAILURE;
        }

        $configuredTimeout = $this->option('timeout');
        $timeout = filter_var(
            $configuredTimeout === null || $configuredTimeout === '' ? $config->timeout : $configuredTimeout,
            FILTER_VALIDATE_INT,
            [
                'options' => ['min_range' => 10, 'max_range' => 600],
            ],
        );

        if ($timeout === false) {
            $this->error('--timeout must be an integer between 10 and 600 seconds.');

            return self::INVALID;
        }

        if ($timeout > $config->timeout) {
            $this->components->warn(sprintf(
                'The requested %d-second timeout exceeds the production provider timeout; using %d seconds to preserve production behavior.',
                $timeout,
                $config->timeout,
            ));
            $timeout = $config->timeout;
        }

        if (trim($config->model) === '') {
            $this->error('No AI model is configured. Select a model in the panel settings first.');

            return self::FAILURE;
        }

        $eligibility = $providerPolicy->check($config);
        if (!$eligibility['allowed']) {
            $this->error($eligibility['reason']);

            return self::FAILURE;
        }

        $directory = $this->resolveOutputDirectory((string) $this->option('output'));
        $suites = $selectedSuite === 'all' ? ['basic', 'advanced'] : [$selectedSuite];
        $saveCalibration = (bool) $this->option('calibrate-tools');

        if ($saveCalibration && (!in_array('basic', $suites, true) || $runs < 3)) {
            $this->error('--calibrate-tools requires --suite=basic or all and --runs=3 or more.');

            return self::INVALID;
        }

        $reasoning = (bool) Setting::get(
            'settings::modules:ai:agent:reasoning',
            config('modules.ai.agent.reasoning', true),
        );
        $this->renderPreflight(
            $config,
            $suites,
            $runs,
            $timeout,
            $reasoning,
            $toolBudget->schemas(),
            $directory,
            $files,
        );

        if ((bool) $this->option('estimate-only')) {
            return self::SUCCESS;
        }

        if (!(bool) $this->option('yes')) {
            if (!$this->input->isInteractive()) {
                $this->error('Confirmation is required. Re-run with --yes for unattended execution.');

                return self::INVALID;
            }

            if (!$this->confirm('Start the benchmark now?', false)) {
                $this->components->info('Benchmark cancelled before any inference request was sent.');

                return self::SUCCESS;
            }
        }

        $this->components->info(sprintf(
            'Benchmarking %s on %s with %s suite%s (%d attempt%s per case)',
            $config->model,
            $config->provider,
            implode(' + ', $suites),
            count($suites) === 1 ? '' : 's',
            $runs,
            $runs === 1 ? '' : 's',
        ));
        $this->line(sprintf(
            'Production profile: reasoning %s, up to %d output tokens per inference turn.',
            $reasoning ? 'enabled' : 'disabled',
            $config->maxTokens,
        ));
        $this->components->warn('The benchmark sends live inference requests, but synthetic tool calls are never executed.');

        $reachable = true;
        $results = [];
        foreach ($suites as $suite) {
            $stem = $this->modelFilenameStem($config->model, $suite);
            $path = $directory . DIRECTORY_SEPARATOR . $stem . '.md';
            $jsonPath = $directory . DIRECTORY_SEPARATOR . $stem . '.json';
            $this->newLine();
            $this->components->info(ucfirst($suite) . ' suite');

            try {
                $provider = $factory->make($timeout);
                $progress = fn (string $title, int $attempt, int $total) => $this->line(
                    sprintf('  [%d/%d] %s', $attempt, $total, $title)
                );
                $result = $suite === 'advanced'
                    ? $advancedBenchmark->run($provider, $runs, $progress, $toolBudget->schemas())
                    : $benchmark->run($provider, $runs, $progress);

                $result['tool_budget'] = [
                    'profile' => $toolBudget->profile(),
                    'schemas' => $toolBudget->schemas(),
                    'total_schemas' => $toolBudget->totalSchemas(),
                    'search_results' => $toolBudget->results(),
                    'source' => $toolBudget->source(),
                    'confidence' => $toolBudget->confidence(),
                    'reason' => $toolBudget->reason(),
                    'parameter_count' => $toolBudget->parameterCount(),
                ];
                $result['benchmark_fingerprint'] = $this->benchmarkFingerprint(
                    $config,
                    $reasoning,
                    $timeout,
                    $suite,
                    $toolBudget->schemas(),
                );

                if ($suite === 'basic') {
                    $result['tool_calibration'] = $calibration->recommend($result);

                    if ($saveCalibration) {
                        if (($result['tool_calibration']['reliable'] ?? false) !== true) {
                            $this->components->warn(
                                'Tool calibration was not saved: ' . $result['tool_calibration']['reason'],
                            );
                        } else {
                            $calibration->save($config, $result['tool_calibration']);
                            // Let a following advanced suite use the calibration saved above.
                            $toolBudget->forgetResolvedProfile();
                            $this->components->info(sprintf(
                                'Saved a %d-schema calibration for this exact model configuration.',
                                $result['tool_calibration']['schemas'],
                            ));
                        }
                    }
                }

                $files->ensureDirectoryExists($directory);
                $files->put($path, $markdown->render($result));
                $files->put($jsonPath, json_encode(
                    $result,
                    JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
                ) . "\n");
                $results[$suite] = $result;
            } catch (\Throwable $exception) {
                $this->error(sprintf(
                    '%s benchmark failed before a report could be completed: %s',
                    ucfirst($suite),
                    $exception->getMessage(),
                ));

                return self::FAILURE;
            }

            $summary = $result['summary'];
            $this->components->info(sprintf(
                '%s finished: %s (%d/%d completed attempts passed; %d incomplete)',
                ucfirst($suite),
                $summary['score_percent'] === null ? 'not scored' : $summary['score_percent'] . '%',
                $summary['passed_attempts'],
                $summary['completed_attempts'] ?? $summary['total_attempts'],
                $summary['incomplete_attempts'] ?? 0,
            ));
            if (($summary['incomplete_attempts'] ?? 0) > 0) {
                $this->components->warn(
                    'One or more attempts were incomplete. Check each stopped reason before comparing this model.',
                );
            }
            $this->line('Report: ' . $path);
            $this->line('Raw trace: ' . $jsonPath);
            $reachable = $reachable && $result['health']['reachable'];
        }

        if (isset($results['basic'], $results['advanced'])) {
            $summaryPath = $directory . DIRECTORY_SEPARATOR
                . $this->modelFilenameStem($config->model, 'basic') . '-discord.md';
            $files->put($summaryPath, $discordReport->render($results['basic'], $results['advanced']));
            $this->line('Discord summary: ' . $summaryPath);
        }

        return $reachable ? self::SUCCESS : self::FAILURE;
    }

    private function resolveOutputDirectory(string $configured): string
    {
        $configured = trim($configured);

        if ($configured === '') {
            return base_path('docs/ai-benchmarks');
        }

        return str_starts_with($configured, DIRECTORY_SEPARATOR)
            ? rtrim($configured, DIRECTORY_SEPARATOR)
            : base_path(rtrim($configured, DIRECTORY_SEPARATOR));
    }

    private function modelFilenameStem(string $model, string $suite): string
    {
        $slug = Str::slug(str_replace(['/', '\\', ':', '.'], '-', $model));

        if ($slug === '') {
            $slug = 'model-' . substr(sha1($model), 0, 12);
        }

        return $slug . ($suite === 'advanced' ? '-advanced' : '');
    }

    /** @param string[] $suites */
    private function renderPreflight(
        ProviderConfig $config,
        array $suites,
        int $runs,
        int $timeout,
        bool $reasoning,
        int $toolSchemas,
        string $directory,
        Filesystem $files,
    ): void {
        $maximumRequests = $runs * array_sum(array_map(
            static fn (string $suite): int => $suite === 'advanced'
                ? AdvancedAiModelBenchmark::CASE_COUNT * AdvancedAiModelBenchmark::MAX_TURNS
                : AiModelBenchmark::CASE_COUNT,
            $suites,
        ));
        $estimate = $this->previousEstimate(
            $config,
            $suites,
            $runs,
            $timeout,
            $reasoning,
            $toolSchemas,
            $directory,
            $files,
        );

        $this->components->warn('This benchmark may take a while and can use a substantial number of tokens.');
        $this->line('Model: ' . $config->model);
        $this->line('Provider: ' . $config->provider);
        $this->line('Suites: ' . implode(' + ', $suites) . '; runs per case: ' . $runs);
        $this->line(sprintf(
            'Production behavior: reasoning %s; %d max output tokens per inference request.',
            $reasoning ? 'enabled' : 'disabled',
            $config->maxTokens,
        ));
        $this->line(sprintf(
            'Harness bounds: %d-second timeout per request; at most %d inference requests.',
            $timeout,
            $maximumRequests,
        ));
        if ($estimate !== null) {
            $this->line(sprintf(
                'Estimate from matching saved report(s): about %s and %s measured tokens.',
                $this->humanDuration($estimate['duration_ms']),
                number_format($estimate['tokens']),
            ));
        } else {
            $this->line('Estimate: unavailable until this exact model configuration has a saved run.');
        }
        $this->line('Eligibility: local/private model endpoint (hosted paid APIs are refused).');
        $this->line('All benchmark tools are synthetic; no panel or server action will execute.');
    }

    /** @param string[] $suites @return array{duration_ms: int, tokens: int}|null */
    private function previousEstimate(
        ProviderConfig $config,
        array $suites,
        int $runs,
        int $timeout,
        bool $reasoning,
        int $toolSchemas,
        string $directory,
        Filesystem $files,
    ): ?array {
        $duration = 0.0;
        $tokens = 0.0;
        $matchedSuites = 0;

        foreach ($suites as $suite) {
            $path = $directory . DIRECTORY_SEPARATOR . $this->modelFilenameStem($config->model, $suite) . '.json';
            if (!$files->exists($path)) {
                continue;
            }

            try {
                $report = json_decode((string) $files->get($path), true, 512, JSON_THROW_ON_ERROR);
            } catch (\Throwable) {
                continue;
            }

            $suiteVersion = $suite === 'advanced'
                ? AdvancedAiModelBenchmark::SUITE_VERSION
                : AiModelBenchmark::SUITE_VERSION;
            $fingerprint = $this->benchmarkFingerprint(
                $config,
                $reasoning,
                $timeout,
                $suite,
                $toolSchemas,
            );
            if (($report['benchmark_fingerprint'] ?? null) !== $fingerprint
                || (int) ($report['suite_version'] ?? 0) !== $suiteVersion) {
                continue;
            }

            $previousRuns = max(1, (int) ($report['runs_per_case'] ?? 1));
            $previousCases = max(1, count($report['cases'] ?? []));
            $currentCases = $suite === 'advanced'
                ? AdvancedAiModelBenchmark::CASE_COUNT
                : AiModelBenchmark::CASE_COUNT;
            $factor = ($runs / $previousRuns) * ($currentCases / $previousCases);
            $duration += max(0, (float) ($report['duration_ms'] ?? 0)) * $factor;
            $tokens += max(0, (int) data_get($report, 'summary.prompt_tokens', 0)) * $factor;
            $tokens += max(0, (int) data_get($report, 'summary.completion_tokens', 0)) * $factor;
            ++$matchedSuites;
        }

        return $matchedSuites === count($suites) ? [
            'duration_ms' => (int) round($duration),
            'tokens' => (int) round($tokens),
        ] : null;
    }

    private function benchmarkFingerprint(
        ProviderConfig $config,
        bool $reasoning,
        int $timeout,
        string $suite,
        int $toolSchemas,
    ): string {
        return hash('sha256', json_encode([
            'provider' => $config->provider,
            'endpoint' => rtrim($config->endpoint, '/'),
            'model' => $config->model,
            'reasoning' => $reasoning,
            'max_tokens' => $config->maxTokens,
            'context_tokens' => $config->contextTokens,
            'timeout' => $timeout,
            'suite' => $suite,
            'suite_version' => $suite === 'advanced'
                ? AdvancedAiModelBenchmark::SUITE_VERSION
                : AiModelBenchmark::SUITE_VERSION,
            'tool_schemas' => $toolSchemas,
        ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR));
    }

    private function humanDuration(int $milliseconds): string
    {
        $seconds = max(1, (int) ceil($milliseconds / 1000));
        $minutes = intdiv($seconds, 60);
        $remaining = $seconds % 60;

        return $minutes > 0
            ? sprintf('%dm %02ds', $minutes, $remaining)
            : $seconds . 's';
    }
}

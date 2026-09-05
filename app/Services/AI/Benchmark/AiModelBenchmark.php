<?php

namespace Everest\Services\AI\Benchmark;

use Everest\Models\Setting;
use Everest\Services\AI\Data\AiTool;
use Everest\Services\AI\Data\AiMessage;
use Everest\Services\AI\Data\AiRequest;
use Everest\Services\AI\Data\AiResponse;
use Everest\Services\AI\Data\AiToolCall;
use Everest\Services\AI\Data\AiStreamEvent;
use Everest\Services\AI\Contracts\AiProvider;
use Everest\Services\AI\Data\ProviderCapabilities;
use Everest\Services\AI\Tools\Definitions\AdminTools;
use Everest\Services\AI\Tools\Definitions\ServerTools;

/**
 * A side-effect-free live benchmark for the model behind an AI provider.
 *
 * Every tool in this suite is synthetic. The provider may ask to call one, but
 * the benchmark only inspects that request; it never passes it to ToolExecutor.
 * This makes the command safe to run against a production panel after changing
 * models while still testing the part small models struggle with most.
 */
class AiModelBenchmark
{
    public const SUITE_VERSION = 5;

    public const CASE_COUNT = 12;

    private const SYSTEM_PROMPT = 'You are a control-panel agent being benchmarked. Follow the user request exactly. '
        . 'When an action requires a provided tool, emit the tool call instead of describing it. '
        . 'Use only arguments stated by the user and do not invent values.';

    private bool $reasoning = true;

    /**
     * @param callable(string, int, int): void|null $progress
     *
     * @return array<string, mixed>
     */
    public function run(AiProvider $provider, int $runs = 1, ?callable $progress = null): array
    {
        $runs = max(1, min(10, $runs));
        $config = $provider->config();
        $this->reasoning = (bool) Setting::get(
            'settings::modules:ai:agent:reasoning',
            config('modules.ai.agent.reasoning', true),
        );
        $startedAt = now();

        $healthStarted = hrtime(true);
        $healthy = $provider->health();
        $healthMs = $this->elapsedMs($healthStarted);

        $capabilityMs = null;
        $capabilities = ProviderCapabilities::unknown('Capability probe skipped because the provider is unreachable.');
        if ($healthy) {
            $capabilityStarted = hrtime(true);
            $capabilities = $provider->capabilities($config->model);
            $capabilityMs = $this->elapsedMs($capabilityStarted);
        }

        $cases = [];
        foreach ($this->cases($config->maxTokens) as $case) {
            $attempts = [];

            if (!$healthy) {
                $cases[] = $this->summariseCase($case, [], 'Provider health check failed; inference was not attempted.');

                continue;
            }

            for ($attempt = 1; $attempt <= $runs; ++$attempt) {
                if ($progress !== null) {
                    $progress($case['title'], $attempt, $runs);
                }

                $result = $case['stream']
                    ? $this->stream($provider, $case['request'])
                    : $this->chat($provider, $case['request']);

                $incomplete = $result['error'] !== null
                    || ($result['finish_reason'] ?? null) === AiResponse::FINISH_LENGTH;
                [$passed, $note] = $incomplete
                    ? [false, $this->incompleteNote($result)]
                    : $case['judge']($result);

                $attempts[] = $result + [
                    'status' => $incomplete ? 'incomplete' : 'completed',
                    'passed' => $passed,
                    'note' => $note,
                ];
            }

            $cases[] = $this->summariseCase($case, $attempts);
        }

        $finishedAt = now();

        return [
            'suite' => 'basic',
            'suite_version' => self::SUITE_VERSION,
            'started_at' => $startedAt->toIso8601String(),
            'finished_at' => $finishedAt->toIso8601String(),
            'duration_ms' => $startedAt->diffInMilliseconds($finishedAt),
            'provider' => $config->provider,
            'model' => $config->model,
            'settings' => [
                'max_tokens' => $config->maxTokens,
                'temperature' => 0.0,
                'configured_temperature' => $config->temperature,
                'reasoning' => $this->reasoning,
                'context_tokens' => $config->contextTokens,
                'keep_alive' => $config->keepAlive,
                'request_timeout_seconds' => $config->timeout,
            ],
            'health' => [
                'reachable' => $healthy,
                'latency_ms' => $healthMs,
            ],
            'capability_probe_ms' => $capabilityMs,
            'capabilities' => $capabilities->toArray(),
            'runs_per_case' => $runs,
            'harness' => [
                'profile' => 'synthetic_microbenchmark',
                'prompt' => 'fixed benchmark instruction',
                'executor' => 'no tool execution',
                'working_set' => 'fixed schema-count cases',
            ],
            'cases' => $cases,
            'summary' => $this->summary($cases),
        ];
    }

    /** @return array<int, array<string, mixed>> */
    private function cases(int $maxTokens): array
    {
        $serverTools = $this->serverTools();
        $adminTools = $this->adminTools();

        return [
            [
                'id' => 'streaming_baseline',
                'title' => 'Streaming baseline',
                'category' => 'protocol',
                'expected' => 'Stream exactly STREAM_OK without a tool call.',
                'stream' => true,
                'request' => $this->request('Reply with exactly STREAM_OK and nothing else.', maxTokens: $maxTokens),
                'judge' => fn (array $result): array => $this->exactText($result, 'STREAM_OK'),
            ],
            [
                'id' => 'exact_instruction',
                'title' => 'Exact instruction following',
                'category' => 'instruction',
                'expected' => 'Return exactly M12_BENCH_OK.',
                'stream' => false,
                'request' => $this->request('Reply with exactly M12_BENCH_OK and nothing else.', maxTokens: $maxTokens),
                'judge' => fn (array $result): array => $this->exactText($result, 'M12_BENCH_OK'),
            ],
            [
                'id' => 'structured_json',
                'title' => 'Structured JSON output',
                'category' => 'structure',
                'expected' => 'Return schema-valid JSON with status=ready and count=3.',
                'stream' => false,
                'request' => new AiRequest(
                    messages: [AiMessage::user('Return status ready and count 3 using the required JSON shape.')],
                    systemPrompt: self::SYSTEM_PROMPT,
                    model: null,
                    maxTokens: $maxTokens,
                    temperature: 0,
                    responseSchema: [
                        'type' => 'object',
                        'properties' => [
                            'status' => ['type' => 'string', 'enum' => ['ready']],
                            'count' => ['type' => 'integer', 'enum' => [3]],
                        ],
                        'required' => ['status', 'count'],
                        'additionalProperties' => false,
                    ],
                    noCache: true,
                    reasoning: $this->reasoning,
                ),
                'judge' => function (array $result): array {
                    $json = json_decode(trim((string) $result['content']), true);
                    $passed = is_array($json)
                        && ($json['status'] ?? null) === 'ready'
                        && ($json['count'] ?? null) === 3
                        && count($json) === 2;

                    return [$passed, $passed ? 'Schema and values matched.' : 'Response was not the required JSON object.'];
                },
            ],
            [
                'id' => 'single_tool',
                'title' => 'Streaming single tool call',
                'category' => 'tool_selection',
                'expected' => 'Assemble one streamed files_read call with file=/server.properties.',
                'stream' => true,
                'request' => $this->request(
                    'Read /server.properties now. Use the provided tool and do not answer in prose.',
                    [$serverTools['files_read']],
                    maxTokens: $maxTokens,
                ),
                'judge' => fn (array $result): array => $this->oneCall(
                    $result,
                    'files_read',
                    ['file' => '/server.properties'],
                ),
            ],
            [
                'id' => 'four_tool_selection',
                'title' => 'Selection among 4 tools',
                'category' => 'tool_selection',
                'expected' => 'Choose server_status with no arguments.',
                'stream' => false,
                'request' => $this->request(
                    'Check whether the server is currently running. Use the correct tool now.',
                    array_values(array_slice($serverTools, 0, 4, true)),
                    maxTokens: $maxTokens,
                ),
                'judge' => fn (array $result): array => $this->oneCall($result, 'server_status', []),
            ],
            [
                'id' => 'eight_tool_selection',
                'title' => 'Selection among 8 tools',
                'category' => 'tool_selection',
                'expected' => 'Choose files_read with file=/logs/latest.log.',
                'stream' => false,
                'request' => $this->request(
                    'Read /logs/latest.log. Use the correct tool now and do not guess another path.',
                    array_values(array_slice($serverTools, 0, 8, true)),
                    maxTokens: $maxTokens,
                ),
                'judge' => fn (array $result): array => $this->oneCall(
                    $result,
                    'files_read',
                    ['file' => '/logs/latest.log'],
                ),
            ],
            [
                'id' => 'twelve_tool_selection',
                'title' => 'Selection among 12 tools',
                'category' => 'tool_selection',
                'expected' => 'Choose admin_tickets_list with status=pending.',
                'stream' => false,
                'request' => $this->request(
                    'List open support tickets. In this panel open means pending. Use the correct tool now.',
                    array_values($adminTools),
                    maxTokens: $maxTokens,
                ),
                'judge' => fn (array $result): array => $this->oneCall(
                    $result,
                    'admin_tickets_list',
                    ['filter' => ['status' => 'pending']],
                ),
            ],
            [
                'id' => 'twenty_tool_selection',
                'title' => 'Selection among 20 real panel tools',
                'category' => 'tool_selection',
                'expected' => 'Choose admin_ticket_messages with ticket=42 from real production schemas.',
                'stream' => false,
                'request' => $this->request(
                    'Read the messages on support ticket 42. Use the correct tool now.',
                    $this->twentyProductionTools(),
                    maxTokens: $maxTokens,
                ),
                'judge' => fn (array $result): array => $this->oneCall(
                    $result,
                    'admin_ticket_messages',
                    ['ticket' => '42'],
                ),
            ],
            [
                'id' => 'typed_arguments',
                'title' => 'Typed argument extraction',
                'category' => 'arguments',
                'expected' => 'Extract a string, integer, and boolean without coercion or invention.',
                'stream' => false,
                'request' => $this->request(
                    'Query /logs/latest.log with exactly 25 lines and do not include archived logs.',
                    [$this->diagnosticQueryTool()],
                    maxTokens: $maxTokens,
                ),
                'judge' => fn (array $result): array => $this->oneCall(
                    $result,
                    'diagnostic_query',
                    ['path' => '/logs/latest.log', 'lines' => 25, 'include_archived' => false],
                ),
            ],
            [
                'id' => 'decline_unneeded_tools',
                'title' => 'Decline unnecessary tools',
                'category' => 'judgment',
                'expected' => 'Answer BLUE without calling a server tool.',
                'stream' => false,
                'request' => $this->request(
                    'Reply with exactly BLUE. This question does not require panel data or a tool.',
                    array_values(array_slice($serverTools, 0, 4, true)),
                    maxTokens: $maxTokens,
                ),
                'judge' => function (array $result): array {
                    $passed = $result['tool_calls'] === [] && trim((string) $result['content']) === 'BLUE';

                    return [$passed, $passed ? 'Correctly answered without a tool.' : 'Called a tool or did not return exact text.'];
                },
            ],
            [
                'id' => 'tool_result_follow_through',
                'title' => 'Tool-result follow-through',
                'category' => 'trajectory',
                'expected' => 'Use the supplied result and return STATE=stopped MEMORY_MB=128.',
                'stream' => false,
                'request' => new AiRequest(
                    messages: [
                        AiMessage::user('Check status, then reply exactly as STATE=<state> MEMORY_MB=<memory_mb>.'),
                        AiMessage::assistant(null, [new AiToolCall('call_benchmark_status', 'server_status')]),
                        AiMessage::tool(
                            'call_benchmark_status',
                            'server_status',
                            '{"state":"stopped","memory_mb":128}'
                        ),
                    ],
                    systemPrompt: self::SYSTEM_PROMPT,
                    tools: [$serverTools['server_status']],
                    toolChoice: AiRequest::TOOL_CHOICE_AUTO,
                    maxTokens: $maxTokens,
                    temperature: 0,
                    noCache: true,
                    reasoning: $this->reasoning,
                ),
                'judge' => fn (array $result): array => $this->exactText(
                    $result,
                    'STATE=stopped MEMORY_MB=128',
                ),
            ],
            [
                'id' => 'parallel_tools',
                'title' => 'Parallel independent tool calls',
                'category' => 'trajectory',
                'expected' => 'Call server_status and startup_list in the same response.',
                'stream' => false,
                'request' => $this->request(
                    'Call both server_status and startup_list now. They are independent. Do not answer in prose.',
                    [$serverTools['server_status'], $serverTools['startup_list']],
                    maxTokens: $maxTokens,
                ),
                'judge' => function (array $result): array {
                    $names = array_values(array_unique(array_column($result['tool_calls'], 'name')));
                    sort($names);
                    $passed = $names === ['server_status', 'startup_list'];

                    return [$passed, $passed ? 'Both independent calls were emitted.' : 'Did not emit both required calls.'];
                },
            ],
        ];
    }

    private function request(string $prompt, array $tools = [], int $maxTokens = 128): AiRequest
    {
        return new AiRequest(
            messages: [AiMessage::user($prompt)],
            systemPrompt: self::SYSTEM_PROMPT,
            tools: $tools,
            toolChoice: AiRequest::TOOL_CHOICE_AUTO,
            maxTokens: $maxTokens,
            temperature: 0,
            noCache: true,
            reasoning: $this->reasoning,
        );
    }

    /** @return array<string, AiTool> */
    private function serverTools(): array
    {
        return $this->selectProductionTools(ServerTools::all(), [
            'server_status', 'files_read', 'files_list', 'startup_list',
            'activity_recent', 'backups_list', 'allocations_list', 'databases_list',
            'schedules_list', 'minecraft_server_info', 'mods_installed', 'console_send',
        ]);
    }

    /** @return array<string, AiTool> */
    private function adminTools(): array
    {
        return $this->selectProductionTools(AdminTools::all(), [
            'admin_overview', 'admin_users_list', 'admin_user_view', 'admin_servers_list',
            'admin_server_view', 'admin_activity', 'admin_billing_analytics',
            'admin_categories_list', 'admin_products_list', 'admin_coupons_list',
            'admin_orders_list', 'admin_tickets_list',
        ]);
    }

    /** @param array<int, mixed> $definitions @param string[] $names @return array<string, AiTool> */
    private function selectProductionTools(array $definitions, array $names): array
    {
        $wanted = array_fill_keys($names, true);
        $tools = [];

        foreach ($definitions as $definition) {
            if (isset($wanted[$definition->name])) {
                $tools[$definition->name] = $definition->toAiTool();
            }
        }

        $missing = array_values(array_diff($names, array_keys($tools)));
        if ($missing !== []) {
            throw new \LogicException('Benchmark tool definitions are missing: ' . implode(', ', $missing));
        }

        // Preserve the benchmark's deliberate ordering rather than the registry's
        // source-file ordering, which can change as unrelated tools are added.
        $ordered = [];
        foreach ($names as $name) {
            if (isset($tools[$name])) {
                $ordered[$name] = $tools[$name];
            }
        }

        return $ordered;
    }

    private function diagnosticQueryTool(): AiTool
    {
        return new AiTool('diagnostic_query', 'Read an exact number of lines from a diagnostic text file.', [
            'type' => 'object',
            'properties' => [
                'path' => ['type' => 'string'],
                'lines' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 100],
                'include_archived' => ['type' => 'boolean'],
            ],
            'required' => ['path', 'lines', 'include_archived'],
            'additionalProperties' => false,
        ]);
    }

    /** @return AiTool[] */
    private function twentyProductionTools(): array
    {
        $target = null;
        $distractors = [];

        foreach (AdminTools::all() as $definition) {
            if ($definition->name === 'admin_ticket_messages') {
                $target = $definition->toAiTool();
                continue;
            }

            if (count($distractors) < 19) {
                $distractors[] = $definition->toAiTool();
            }
        }

        if ($target === null || count($distractors) !== 19) {
            throw new \LogicException('The 20-tool benchmark case requires its target and 19 distractors.');
        }

        return [...$distractors, $target];
    }

    /** @return array<string, mixed> */
    private function chat(AiProvider $provider, AiRequest $request): array
    {
        $started = hrtime(true);

        try {
            $response = $provider->chat($request);

            return $this->normaliseResponse($response, $this->elapsedMs($started));
        } catch (\Throwable $exception) {
            return $this->failedAttempt($started, $exception);
        }
    }

    /** @return array<string, mixed> */
    private function stream(AiProvider $provider, AiRequest $request): array
    {
        $started = hrtime(true);
        $firstTokenMs = null;
        $content = '';
        $toolCalls = [];
        $usage = [];
        $finishReason = AiResponse::FINISH_STOP;
        $done = false;

        try {
            foreach ($provider->stream($request) as $event) {
                if ($event->type === AiStreamEvent::TYPE_TEXT) {
                    $firstTokenMs ??= $this->elapsedMs($started);
                    $content .= (string) $event->text;
                } elseif ($event->type === AiStreamEvent::TYPE_TOOL_CALL && $event->toolCall !== null) {
                    $firstTokenMs ??= $this->elapsedMs($started);
                    $toolCalls[] = $event->toolCall->toArray();
                } elseif ($event->type === AiStreamEvent::TYPE_TOOL_CALL_START) {
                    $firstTokenMs ??= $this->elapsedMs($started);
                } elseif ($event->type === AiStreamEvent::TYPE_USAGE) {
                    $usage = $event->usage;
                } elseif ($event->type === AiStreamEvent::TYPE_DONE) {
                    $done = true;
                    $finishReason = $event->finishReason ?? $finishReason;
                } elseif ($event->type === AiStreamEvent::TYPE_ERROR) {
                    throw new \RuntimeException($event->error ?: 'The provider emitted a streaming error.');
                }
            }

            if (!$done) {
                throw new \RuntimeException('The provider stream ended before its completion event.');
            }

            return [
                'content' => $content,
                'tool_calls' => $toolCalls,
                'finish_reason' => $finishReason,
                'usage' => $this->normaliseUsage($usage),
                'duration_ms' => $this->elapsedMs($started),
                'first_token_ms' => $firstTokenMs,
                'error' => null,
            ];
        } catch (\Throwable $exception) {
            return $this->failedAttempt($started, $exception, $firstTokenMs);
        }
    }

    /** @return array<string, mixed> */
    private function normaliseResponse(AiResponse $response, float $durationMs): array
    {
        return [
            'content' => (string) $response->content,
            'tool_calls' => array_map(fn (AiToolCall $call): array => $call->toArray(), $response->toolCalls),
            'finish_reason' => $response->finishReason,
            'usage' => $this->normaliseUsage($response->usage),
            'duration_ms' => $durationMs,
            'first_token_ms' => null,
            'error' => null,
        ];
    }

    private function incompleteNote(array $result): string
    {
        if (($result['finish_reason'] ?? null) === AiResponse::FINISH_LENGTH) {
            return 'Incomplete: The provider reached the configured output-token ceiling.';
        }

        return 'Incomplete: ' . (string) ($result['error'] ?? 'The provider did not complete the attempt.');
    }

    /** @return array<string, mixed> */
    private function failedAttempt(int $started, \Throwable $exception, ?float $firstTokenMs = null): array
    {
        return [
            'content' => '',
            'tool_calls' => [],
            'finish_reason' => AiResponse::FINISH_ERROR,
            'usage' => $this->normaliseUsage([]),
            'duration_ms' => $this->elapsedMs($started),
            'first_token_ms' => $firstTokenMs,
            'error' => sprintf('%s: %s', class_basename($exception), $exception->getMessage()),
        ];
    }

    /** @return array<string, int|float|string|null> */
    private function normaliseUsage(array $usage): array
    {
        $prompt = isset($usage['prompt_tokens']) && is_numeric($usage['prompt_tokens'])
            ? (int) $usage['prompt_tokens']
            : null;
        $completion = isset($usage['completion_tokens']) && is_numeric($usage['completion_tokens'])
            ? (int) $usage['completion_tokens']
            : null;
        $total = isset($usage['total_tokens']) && is_numeric($usage['total_tokens'])
            ? (int) $usage['total_tokens']
            : (($prompt !== null && $completion !== null) ? $prompt + $completion : null);

        return [
            'prompt_tokens' => $prompt,
            'completion_tokens' => $completion,
            'total_tokens' => $total,
            'generation_duration_ms' => isset($usage['generation_duration_ms'])
                && is_numeric($usage['generation_duration_ms'])
                    ? (float) $usage['generation_duration_ms']
                    : null,
            'generation_timing_source' => is_string($usage['generation_timing_source'] ?? null)
                ? $usage['generation_timing_source']
                : null,
        ];
    }

    /** @return array{bool, string} */
    private function exactText(array $result, string $expected): array
    {
        $passed = $result['tool_calls'] === [] && trim((string) $result['content']) === $expected;

        return [$passed, $passed ? 'Exact text matched.' : 'Response text or tool behavior did not match.'];
    }

    /** @return array{bool, string} */
    private function oneCall(array $result, string $name, array $arguments): array
    {
        $calls = $result['tool_calls'];
        $passed = count($calls) === 1
            && ($calls[0]['name'] ?? null) === $name
            && $this->sameArguments($calls[0]['arguments'] ?? null, $arguments);

        return [$passed, $passed ? 'Tool name and arguments matched.' : 'Tool name, call count, or arguments differed.'];
    }

    private function sameArguments(mixed $actual, array $expected): bool
    {
        if (!is_array($actual)) {
            return false;
        }

        ksort($actual);
        ksort($expected);

        return $actual === $expected;
    }

    /** @return array<string, mixed> */
    private function summariseCase(array $case, array $attempts, ?string $skipped = null): array
    {
        $completed = array_values(array_filter(
            $attempts,
            static fn (array $attempt): bool => ($attempt['status'] ?? 'completed') === 'completed',
        ));
        $passes = count(array_filter($completed, fn (array $attempt): bool => $attempt['passed']));
        $latencies = array_column($attempts, 'duration_ms');

        return [
            'id' => $case['id'],
            'title' => $case['title'],
            'category' => $case['category'],
            'expected' => $case['expected'],
            'attempts' => $attempts,
            'passed_attempts' => $passes,
            'total_attempts' => count($attempts),
            'completed_attempts' => count($completed),
            'incomplete_attempts' => count($attempts) - count($completed),
            'pass_rate' => $completed === [] ? null : round($passes / count($completed), 4),
            'median_latency_ms' => $this->median($latencies),
            'skipped_reason' => $skipped,
        ];
    }

    /** @return array<string, int|float|null> */
    private function summary(array $cases): array
    {
        $attempts = array_merge(...array_map(fn (array $case): array => $case['attempts'], $cases));
        $completed = array_values(array_filter(
            $attempts,
            static fn (array $attempt): bool => ($attempt['status'] ?? 'completed') === 'completed',
        ));
        $passed = count(array_filter($completed, fn (array $attempt): bool => $attempt['passed']));
        $latencies = array_column($attempts, 'duration_ms');
        $firstTokens = array_values(array_filter(
            array_column($attempts, 'first_token_ms'),
            fn (mixed $value): bool => is_numeric($value),
        ));
        $promptTokens = 0;
        $completionTokens = 0;
        $generationTokens = 0;
        $generationDurationMs = 0.0;
        $knownPrompt = false;
        $knownCompletion = false;

        foreach ($attempts as $attempt) {
            if ($attempt['usage']['prompt_tokens'] !== null) {
                $promptTokens += $attempt['usage']['prompt_tokens'];
                $knownPrompt = true;
            }
            if ($attempt['usage']['completion_tokens'] !== null) {
                $completionTokens += $attempt['usage']['completion_tokens'];
                $knownCompletion = true;
            }
            if (($attempt['usage']['generation_duration_ms'] ?? null) > 0
                && $attempt['usage']['completion_tokens'] !== null) {
                $generationTokens += $attempt['usage']['completion_tokens'];
                $generationDurationMs += $attempt['usage']['generation_duration_ms'];
            }
        }

        $attemptDurationMs = array_sum($latencies);

        return [
            'passed_attempts' => $passed,
            'total_attempts' => count($attempts),
            'completed_attempts' => count($completed),
            'incomplete_attempts' => count($attempts) - count($completed),
            'score_percent' => $completed === [] ? null : round(($passed / count($completed)) * 100, 1),
            'median_latency_ms' => $this->median($latencies),
            'median_first_token_ms' => $this->median($firstTokens),
            'prompt_tokens' => $knownPrompt ? $promptTokens : null,
            'completion_tokens' => $knownCompletion ? $completionTokens : null,
            'generation_tokens' => $generationDurationMs > 0 ? $generationTokens : null,
            'generation_duration_ms' => $generationDurationMs > 0 ? round($generationDurationMs, 2) : null,
            'generation_tokens_per_second' => $generationDurationMs > 0
                ? round($generationTokens / ($generationDurationMs / 1000), 2)
                : null,
            'end_to_end_output_tokens_per_second' => $knownCompletion && $attemptDurationMs > 0
                ? round($completionTokens / ($attemptDurationMs / 1000), 2)
                : null,
        ];
    }

    private function elapsedMs(int $started): float
    {
        return round((hrtime(true) - $started) / 1_000_000, 2);
    }

    private function median(array $values): ?float
    {
        if ($values === []) {
            return null;
        }

        sort($values, SORT_NUMERIC);
        $middle = intdiv(count($values), 2);

        return round(count($values) % 2 === 0
            ? ($values[$middle - 1] + $values[$middle]) / 2
            : $values[$middle], 2);
    }
}

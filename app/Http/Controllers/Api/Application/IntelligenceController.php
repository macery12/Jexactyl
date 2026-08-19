<?php

namespace Everest\Http\Controllers\Api\Application;

use Everest\Models\Setting;
use Everest\Facades\Activity;
use Illuminate\Http\Response;
use Everest\Models\AiUsageLog;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;
use Everest\Services\AI\OpenAIService;
use Everest\Services\AI\Agent\ToolBudget;
use Everest\Services\Email\EmailRedactor;
use Illuminate\Support\Facades\RateLimiter;
use Everest\Services\AI\Privacy\PiiRedactor;
use Everest\Http\Requests\Api\Application\Intelligence;
use Everest\Http\Requests\Api\Application\Intelligence\GetIntelligenceRequest;

class IntelligenceController extends ApplicationApiController
{
    /**
     * IntelligenceController constructor.
     */
    public function __construct(
        private OpenAIService $aiService,
        private PiiRedactor $redactor,
        private ToolBudget $budget,
    ) {
        parent::__construct();
    }

    /**
     * Get the current AI settings for the admin panel.
     */
    public function index(GetIntelligenceRequest $request): JsonResponse
    {
        $factory = app(\Everest\Services\AI\ProviderFactory::class);

        return response()->json([
            'enabled' => boolval(config('modules.ai.enabled', false)),
            'key' => !empty(config('modules.ai.key')),
            'endpoint' => config('modules.ai.endpoint', ''),
            'model' => config('modules.ai.model', ''),

            // `mode` predates multi-provider support and is still what old
            // installs are configured with, so the resolved provider is
            // returned alongside it rather than in place of it.
            'mode' => config('modules.ai.mode', 'ollama'),
            'provider' => $factory->provider(),
            'models' => [
                'agent' => (string) config('modules.ai.models.agent', ''),
                'fast' => (string) config('modules.ai.models.fast', ''),
            ],

            'max_tokens' => (int) config('modules.ai.max_tokens', 1024),
            'temperature' => (float) config('modules.ai.temperature', 0.3),
            'context_tokens' => config('modules.ai.context_tokens') ? (int) config('modules.ai.context_tokens') : null,
            'keep_alive' => (string) config('modules.ai.keep_alive', '10m'),
            'warm' => boolval(config('modules.ai.warm', false)),
            'system_prompt' => config('modules.ai.system_prompt', ''),

            'feature_server_assistant' => boolval(config('modules.ai.feature_server_assistant', true)),
            'feature_crash_analysis' => boolval(config('modules.ai.feature_crash_analysis', true)),

            'agent' => [
                'enabled' => boolval(config('modules.ai.agent.enabled', false)),
                'admin_enabled' => boolval(config('modules.ai.agent.admin_enabled', false)),
                'reasoning' => boolval(config('modules.ai.agent.reasoning', true)),
                'max_steps' => (int) config('modules.ai.agent.max_steps', 12),
                'max_wall_seconds' => (int) config('modules.ai.agent.max_wall_seconds', 180),
                'max_tool_seconds' => (int) config('modules.ai.agent.max_tool_seconds', 90),
                'tool_result_bytes' => (int) config('modules.ai.agent.tool_result_bytes', 12288),
                'max_repairs' => (int) config('modules.ai.agent.max_repairs', 2),
                // Null means auto. Kept null rather than resolved, so the form
                // can tell "the operator chose 12" from "the panel worked out 12"
                // — the second has to keep tracking the model when it changes.
                'max_tools' => config('modules.ai.agent.max_tools') === null
                    ? null
                    : (int) config('modules.ai.agent.max_tools'),
                'max_batch_calls' => (int) config('modules.ai.agent.max_batch_calls', 25),
                'allow_destructive_batches' => boolval(config('modules.ai.agent.allow_destructive_batches', false)),

                // What the budget actually resolved to, so an operator can see
                // the consequence of leaving it on auto without having to guess.
                'tool_budget' => [
                    'profile' => $this->budget->profile(),
                    'schemas' => $this->budget->schemas(),
                    'results' => $this->budget->results(),
                ],
            ],

            'concurrency' => [
                'slots' => config('modules.ai.concurrency.slots') ? (int) config('modules.ai.concurrency.slots') : null,
                'queue_depth' => (int) config('modules.ai.concurrency.queue_depth', 20),
                'max_wait_seconds' => (int) config('modules.ai.concurrency.max_wait_seconds', 120),
                'per_user' => (int) config('modules.ai.concurrency.per_user', 1),
            ],

            'budget' => [
                'enforce' => boolval(config('modules.ai.budget.enforce', false)),
                'monthly_tokens' => (int) config('modules.ai.budget.monthly_tokens', 2000000),
            ],

            // Read through the redactor rather than off config: the category
            // list is a JSON blob that is never hydrated into config, and it is
            // the redactor that knows an unset value means "the defaults" rather
            // than "none selected".
            'privacy' => [
                'enabled' => $this->redactor->enabled(),
                'categories' => $this->redactor->activeKinds(),
                'available' => PiiRedactor::KINDS,
            ],
        ]);
    }

    /**
     * Update the AI settings for the Panel.
     *
     * @throws \Throwable
     */
    public function update(Intelligence\UpdateIntelligenceSettingsRequest $request): Response
    {
        // `normalize()` also blanks the endpoint and key when the provider is
        // changing, since both are a single slot shared across providers.
        foreach ($request->normalize() as $key => $value) {
            if ($key == 'key' && is_bool($value)) {
                continue;
            }

            Setting::set('settings::modules:ai:' . $key, $value);
        }

        $activitySettings = EmailRedactor::redactSensitivePayload(
            $request->all(),
            ['api_key', 'token', 'secret', 'password', 'authorization', 'key']
        );

        Activity::event('admin:ai:update')
            ->property('settings', $activitySettings)
            ->description('M12Labs-AI settings were updated')
            ->log();

        return $this->returnNoContent();
    }

    /**
     * Test the connection to the configured AI endpoint.
     *
     * The check itself is cheap (a models listing, not a generation) and the
     * result is cached for 5 minutes so the admin overview doesn't hammer the
     * endpoint on every visit. Pass ?fresh=1 to force a live re-test.
     */
    public function testConnection(GetIntelligenceRequest $request): JsonResponse
    {
        $cacheKey = 'ai:health:' . $this->connectionFingerprint();

        if (!$request->boolean('fresh')) {
            $cached = Cache::get($cacheKey);
            if (is_array($cached)) {
                return response()->json($cached + ['from_cache' => true], $cached['status'] === 'ok' ? 200 : 502);
            }
        }

        $start = microtime(true);

        try {
            $ok = $this->aiService->testConnection();
            $latencyMs = (int) round((microtime(true) - $start) * 1000);

            $result = $ok
                ? ['status' => 'ok', 'latency_ms' => $latencyMs]
                : ['status' => 'error', 'message' => 'AI service returned an unexpected response.', 'latency_ms' => $latencyMs];
        } catch (\Exception $e) {
            $latencyMs = (int) round((microtime(true) - $start) * 1000);
            $result = ['status' => 'error', 'message' => $e->getMessage(), 'latency_ms' => $latencyMs];
        }

        Cache::put($cacheKey, $result, 300);

        return response()->json($result, $result['status'] === 'ok' ? 200 : 502);
    }

    /**
     * List the models available on the configured endpoint (Ollama installed
     * models with sizes, or the provider's /models listing). Cached 5 minutes;
     * pass ?fresh=1 to re-fetch.
     */
    public function models(GetIntelligenceRequest $request): JsonResponse
    {
        $cacheKey = 'ai:models:' . $this->connectionFingerprint();

        if (!$request->boolean('fresh')) {
            $cached = Cache::get($cacheKey);
            if (is_array($cached)) {
                return response()->json(['data' => $cached, 'from_cache' => true]);
            }
        }

        try {
            $models = $this->aiService->listModels();
        } catch (\Exception $e) {
            return response()->json(['error' => $e->getMessage()], 502);
        }

        Cache::put($cacheKey, $models, 300);

        return response()->json(['data' => $models]);
    }

    /**
     * Cache discriminator for anything probed from the live endpoint.
     *
     * Keyed on the resolved provider rather than the deprecated `mode`, which
     * no longer changes when the provider does — a switch would otherwise keep
     * serving the previous provider's health and model listing.
     */
    private function connectionFingerprint(): string
    {
        $factory = app(\Everest\Services\AI\ProviderFactory::class);

        return sha1($factory->provider() . '|' . config('modules.ai.endpoint', ''));
    }

    /**
     * Send a query to the AI service using OpenAI-compatible API.
     *
     * @throws \Throwable
     */
    public function query(Intelligence\QueryRequest $request): JsonResponse|\Symfony\Component\HttpFoundation\StreamedResponse
    {
        $enabled = filter_var(
            Setting::get('settings::modules:ai:enabled', config('modules.ai.enabled', false)),
            FILTER_VALIDATE_BOOLEAN
        );

        if (!$enabled) {
            return response()->json(['error' => 'The M12Labs-AI module is not enabled.'], 403);
        }

        // Rate-limit admin queries (60 per 10 minutes).
        $rateLimitKey = 'ai:admin:' . ($request->user()?->id ?? 'anon');
        if (RateLimiter::tooManyAttempts($rateLimitKey, 60)) {
            $retryAfter = RateLimiter::availableIn($rateLimitKey);

            return response()->json([
                'error' => 'Too many AI requests. Please try again in ' . $retryAfter . ' seconds.',
                'retry_after' => $retryAfter,
            ], 429);
        }
        RateLimiter::hit($rateLimitKey, 600);

        // Check if streaming is requested
        if ($request->input('stream', false)) {
            $userId = $request->user()?->id;
            $model = Setting::get('settings::modules:ai:model', config('modules.ai.model', 'unknown'));

            return response()->stream(function () use ($request, $userId, $model) {
                $start = microtime(true);
                $status = 'success';
                $errorMsg = null;

                try {
                    foreach ($this->aiService->queryStream($request->input('query')) as $chunk) {
                        echo 'data: ' . json_encode(['content' => $chunk]) . "\n\n";
                        ob_flush();
                        flush();
                    }
                    echo "data: [DONE]\n\n";
                    ob_flush();
                    flush();
                } catch (\Exception $e) {
                    $status = 'error';
                    $errorMsg = $e->getMessage();
                    echo 'data: ' . json_encode(['error' => $e->getMessage()]) . "\n\n";
                    ob_flush();
                    flush();
                }

                $latencyMs = (int) round((microtime(true) - $start) * 1000);
                try {
                    AiUsageLog::create([
                        'user_id' => $userId,
                        'model' => $model,
                        'source' => 'admin',
                        'latency_ms' => $latencyMs,
                        'status' => $status,
                        'cached' => $this->aiService->wasCached(),
                        'error_message' => $errorMsg,
                    ]);
                } catch (\Exception $logEx) {
                    Log::warning('Failed to write AI usage log: ' . $logEx->getMessage());
                }
            }, 200, [
                'Content-Type' => 'text/event-stream',
                'Cache-Control' => 'no-cache',
                'X-Accel-Buffering' => 'no',
            ]);
        }

        $model = Setting::get('settings::modules:ai:model', config('modules.ai.model', 'unknown'));
        $start = microtime(true);

        try {
            $result = $this->aiService->query($request->input('query'));
            $latencyMs = (int) round((microtime(true) - $start) * 1000);
            $usage = $this->aiService->getLastUsage();

            try {
                AiUsageLog::create([
                    'user_id' => $request->user()?->id,
                    'model' => $usage['model'] ?? $model,
                    'source' => 'admin',
                    'prompt_tokens' => $usage['prompt_tokens'] ?? null,
                    'completion_tokens' => $usage['completion_tokens'] ?? null,
                    'total_tokens' => $usage['total_tokens'] ?? null,
                    'latency_ms' => $latencyMs,
                    'status' => 'success',
                    'cached' => $this->aiService->wasCached(),
                ]);
            } catch (\Exception $logEx) {
                Log::warning('Failed to write AI usage log: ' . $logEx->getMessage());
            }

            return response()->json($result);
        } catch (\Exception $e) {
            $latencyMs = (int) round((microtime(true) - $start) * 1000);
            try {
                AiUsageLog::create([
                    'user_id' => $request->user()?->id,
                    'model' => $model,
                    'source' => 'admin',
                    'latency_ms' => $latencyMs,
                    'status' => 'error',
                    'error_message' => $e->getMessage(),
                ]);
            } catch (\Exception $logEx) {
                Log::warning('Failed to write AI usage log: ' . $logEx->getMessage());
            }
            throw $e;
        }
    }

    /**
     * Return aggregated usage statistics from ai_usage_logs.
     */
    public function stats(GetIntelligenceRequest $request): JsonResponse
    {
        $now = now();

        // All-time totals
        $allTime = AiUsageLog::selectRaw('
            COUNT(*) as total_requests,
            SUM(CASE WHEN status = "success" THEN 1 ELSE 0 END) as successful,
            SUM(CASE WHEN status = "error" THEN 1 ELSE 0 END) as errors,
            SUM(CASE WHEN cached = 1 THEN 1 ELSE 0 END) as cache_hits,
            SUM(COALESCE(total_tokens, 0)) as total_tokens,
            ROUND(AVG(latency_ms)) as avg_latency_ms
        ')->first();

        // Last 24 hours
        $last24h = AiUsageLog::where('created_at', '>=', $now->copy()->subDay())
            ->selectRaw('COUNT(*) as requests, SUM(COALESCE(total_tokens, 0)) as tokens')
            ->first();

        // Last 7 days
        $last7d = AiUsageLog::where('created_at', '>=', $now->copy()->subDays(7))
            ->selectRaw('
                COUNT(*) as requests,
                SUM(COALESCE(total_tokens, 0)) as tokens,
                SUM(COALESCE(prompt_tokens, 0)) as prompt_tokens,
                SUM(COALESCE(completion_tokens, 0)) as completion_tokens,
                SUM(CASE WHEN cached = 1 THEN 1 ELSE 0 END) as cache_hits,
                SUM(CASE WHEN status = "error" THEN 1 ELSE 0 END) as errors
            ')
            ->first();

        // Month to date, which is the window a monthly token budget is measured
        // against. Panel-wide rather than per-user: the budget the operator set
        // is the panel's, and a per-user figure cannot be summed back into it
        // from here without loading every user.
        $monthTokens = (int) AiUsageLog::where('created_at', '>=', $now->copy()->startOfMonth())
            ->sum('total_tokens');

        // Latency spread, bucketed rather than averaged.
        //
        // An agent turn is many model calls and a chat is one, so the two live
        // in the same column with wildly different shapes — a mean over them
        // describes neither. Buckets show the bimodality directly, and are
        // portable SQL where a percentile function is not.
        $latency = AiUsageLog::where('created_at', '>=', $now->copy()->subDays(7))
            ->whereNotNull('latency_ms')
            ->selectRaw('
                SUM(CASE WHEN latency_ms < 1000 THEN 1 ELSE 0 END) as under_1s,
                SUM(CASE WHEN latency_ms >= 1000 AND latency_ms < 5000 THEN 1 ELSE 0 END) as to_5s,
                SUM(CASE WHEN latency_ms >= 5000 AND latency_ms < 15000 THEN 1 ELSE 0 END) as to_15s,
                SUM(CASE WHEN latency_ms >= 15000 AND latency_ms < 60000 THEN 1 ELSE 0 END) as to_60s,
                SUM(CASE WHEN latency_ms >= 60000 THEN 1 ELSE 0 END) as over_60s,
                MAX(latency_ms) as slowest_ms,
                ROUND(AVG(latency_ms)) as avg_ms
            ')
            ->first();

        // Requests per day for the last 7 days (for sparkline)
        $dailySeries = AiUsageLog::where('created_at', '>=', $now->copy()->subDays(6)->startOfDay())
            ->selectRaw('DATE(created_at) as date, COUNT(*) as requests')
            ->groupBy('date')
            ->orderBy('date')
            ->get()
            ->keyBy('date');

        // Fill missing days with 0
        $series = [];
        for ($i = 6; $i >= 0; --$i) {
            $date = $now->copy()->subDays($i)->format('Y-m-d');
            $series[] = [
                'date' => $date,
                'requests' => $dailySeries[$date]->requests ?? 0,
            ];
        }

        // Top 5 active users by request count (last 7 days)
        $topUsers = AiUsageLog::where('created_at', '>=', $now->copy()->subDays(7))
            ->whereNotNull('user_id')
            ->selectRaw('user_id, COUNT(*) as requests')
            ->groupBy('user_id')
            ->orderByDesc('requests')
            ->limit(5)
            ->with('user:id,username,email')
            ->get()
            ->map(fn ($row) => [
                'username' => $row->user?->username ?? 'unknown',
                'email' => $row->user?->email ?? null,
                'requests' => $row->requests,
            ]);

        // Every source that produced traffic in the window, not a fixed pair.
        // There are five in the codebase — client, agent, admin, admin-agent
        // and modpack — and a UI that reads two of them by name reports a panel
        // running nothing but agent turns as almost entirely idle.
        $sourceBreakdown = AiUsageLog::where('created_at', '>=', $now->copy()->subDays(7))
            ->selectRaw('source, COUNT(*) as requests')
            ->groupBy('source')
            ->get()
            ->pluck('requests', 'source');

        return response()->json([
            'all_time' => $allTime,
            'last_24h' => $last24h,
            'last_7d' => $last7d,
            'month_to_date_tokens' => $monthTokens,
            'latency' => $latency,
            'daily_series' => $series,
            'top_users' => $topUsers,
            'source_breakdown' => $sourceBreakdown,
        ]);
    }

    /**
     * Return the most recent 30 usage log entries for the admin log table.
     */
    public function recentLogs(GetIntelligenceRequest $request): JsonResponse
    {
        $limit  = min((int) $request->query('limit', 10), 500);
        $source = $request->query('source');
        $status = $request->query('status');
        $search = $request->query('search');
        if ($search !== null) {
            $search = mb_substr((string) $search, 0, 100);
        }

        $query = AiUsageLog::with('user:id,username,email', 'server:uuid,name')
            ->orderByDesc('created_at');

        // All five producers, not the two the filter used to know: narrowing to
        // "client" excluded every agent turn, which on a panel using the agent
        // is most of the log.
        if (in_array($source, ['client', 'agent', 'admin', 'admin-agent', 'modpack'], true)) {
            $query->where('source', $source);
        }
        if (in_array($status, ['success', 'error'], true)) {
            $query->where('status', $status);
        }
        if ($search) {
            $query->whereHas('user', fn ($q) => $q->where('username', 'like', '%' . $search . '%')
                ->orWhere('email', 'like', '%' . $search . '%'));
        }

        $logs = $query->limit($limit)->get()->map(fn ($log) => [
            'id'            => $log->id,
            'created_at'    => $log->created_at?->toIso8601String(),
            'username'      => $log->user?->username ?? 'system',
            'server_name'   => $log->server?->name ?? null,
            'model'         => $log->model,
            'source'        => $log->source,
            'status'        => $log->status,
            'cached'        => (bool) $log->cached,
            'total_tokens'  => $log->total_tokens,
            'latency_ms'    => $log->latency_ms,
            'error_message' => $log->error_message,
        ]);

        return response()->json($logs);
    }
}

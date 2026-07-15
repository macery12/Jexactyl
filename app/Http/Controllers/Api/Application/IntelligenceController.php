<?php

namespace Everest\Http\Controllers\Api\Application;

use Everest\Models\Setting;
use Everest\Models\AiUsageLog;
use Everest\Facades\Activity;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\RateLimiter;
use Everest\Services\AI\OpenAIService;
use Everest\Services\Email\EmailRedactor;
use Everest\Http\Requests\Api\Application\Intelligence;

class IntelligenceController extends ApplicationApiController
{
    /**
     * IntelligenceController constructor.
     */
    public function __construct(private OpenAIService $aiService)
    {
        parent::__construct();
    }

    /**
     * Get the current AI settings for the admin panel.
     */
    public function index(): JsonResponse
    {
        return response()->json([
            'enabled' => boolval(config('modules.ai.enabled', false)),
            'key' => !empty(config('modules.ai.key')),
            'endpoint' => config('modules.ai.endpoint', 'https://api.openai.com/v1'),
            'model' => config('modules.ai.model', 'gpt-4.1-mini'),
            'mode' => config('modules.ai.mode', 'openai'),
            'max_tokens' => (int) config('modules.ai.max_tokens', 200),
            'temperature' => (float) config('modules.ai.temperature', 0.3),
            'keep_alive' => (string) config('modules.ai.keep_alive', '10m'),
            'warm' => boolval(config('modules.ai.warm', false)),
            'system_prompt' => config('modules.ai.system_prompt', 'You are a helpful assistant for a game server hosting panel. Provide clear, concise, and technical responses.'),
            'feature_server_assistant' => boolval(config('modules.ai.feature_server_assistant', true)),
            'feature_crash_analysis' => boolval(config('modules.ai.feature_crash_analysis', true)),
        ]);
    }

    /**
     * Update the AI settings for the Panel.
     *
     * @throws \Throwable
     */
    public function update(Intelligence\UpdateIntelligenceSettingsRequest $request): Response
    {
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
    public function testConnection(Request $request): JsonResponse
    {
        $cacheKey = 'ai:health:' . sha1(config('modules.ai.mode', 'openai') . '|' . config('modules.ai.endpoint', ''));

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
    public function models(Request $request): JsonResponse
    {
        $cacheKey = 'ai:models:' . sha1(config('modules.ai.mode', 'openai') . '|' . config('modules.ai.endpoint', ''));

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
    public function stats(): JsonResponse
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
            ->selectRaw('COUNT(*) as requests, SUM(COALESCE(total_tokens, 0)) as tokens, SUM(CASE WHEN cached = 1 THEN 1 ELSE 0 END) as cache_hits')
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
        for ($i = 6; $i >= 0; $i--) {
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

        // Source breakdown (client vs admin, last 7 days)
        $sourceBreakdown = AiUsageLog::where('created_at', '>=', $now->copy()->subDays(7))
            ->selectRaw('source, COUNT(*) as requests')
            ->groupBy('source')
            ->get()
            ->pluck('requests', 'source');

        return response()->json([
            'all_time' => $allTime,
            'last_24h' => $last24h,
            'last_7d' => $last7d,
            'daily_series' => $series,
            'top_users' => $topUsers,
            'source_breakdown' => $sourceBreakdown,
        ]);
    }

    /**
     * Return the most recent 30 usage log entries for the admin log table.
     */
    public function recentLogs(Request $request): JsonResponse
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

        if (in_array($source, ['client', 'admin'], true)) {
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

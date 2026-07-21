<?php

namespace Everest\Http\Controllers\Api\Client\Servers;

use Everest\Models\Server;
use Everest\Models\Setting;
use Everest\Models\AiUsageLog;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use Everest\Services\AI\OpenAIService;
use Everest\Http\Controllers\Api\Client\ClientApiController;

class AIController extends ClientApiController
{
    /**
     * AIController constructor.
     */
    public function __construct(private OpenAIService $aiService)
    {
        parent::__construct();
    }

    /**
     * Extract only signal lines from raw console output.
     * Keeps ERROR/EXCEPTION/WARN/FATAL lines + stacktrace markers.
     * Reduces a 6000-char log to ~1500 chars of actual evidence,
     * cutting Ollama input tokens by 3-5x and improving TTFT significantly.
     */
    private function filterLogLines(string $rawLog): string
    {
        $lines = explode("\n", $rawLog);

        $patterns = [
            'error', 'exception', 'fatal', 'crash', 'warn', 'severe',
            'caused by', 'java.lang.', 'java.io.', 'java.net.',
            'outofmemory', 'stackoverflow', 'killed', 'oom',
            'eula', 'at com.', 'at net.', 'at org.', 'at java.',
            'noclassdef', 'classnotfound', 'nullpointer',
            'segfault', 'core dump', 'failed to', 'unable to',
            'could not', 'no such file', 'permission denied',
        ];

        $signal = [];
        foreach ($lines as $line) {
            $lower = strtolower($line);
            foreach ($patterns as $p) {
                if (str_contains($lower, $p)) {
                    $signal[] = trim($line);
                    break;
                }
            }
        }

        if (count($signal) >= 3) {
            $out = implode("\n", array_slice($signal, -60));
            return substr($out, -3000);
        }

        // Fallback: raw tail (non-Java servers)
        $tail = implode("\n", array_slice($lines, -80));
        return substr($tail, -3000);
    }

    /**
     * Build a compact prompt. Short prompts = faster Ollama TTFT.
     * Every extra input token must be processed before the first output token.
     */
    private function buildPrompt(Server $server, string $rawQuery, string $queryType): string
    {
        $server->loadMissing('egg');
        $eggName = $server->egg?->name ?? 'Unknown';
        $status  = $server->status ?? 'running';
        $ctx     = "{$eggName} | {$status} | {$server->memory}MB RAM | {$server->cpu}% CPU";

        if ($queryType === 'log_analysis') {
            $log = $this->filterLogLines($rawQuery);
            return "Server: {$ctx}\n\nLog (errors/exceptions):\n{$log}\n\nDiagnose: quote the exact failing line. State if crash, config issue, or first-run requirement (EULA etc). Format: Issue / Evidence / Fix.";
        }

        return "Server: {$ctx}\nQ: {$rawQuery}\nAnswer specifically for {$eggName}.";
    }

    /**
     * Send an AI generated response to debug a server error.
     */
    public function index(Request $request, Server $server): JsonResponse|\Symfony\Component\HttpFoundation\StreamedResponse
    {
        $enabled = filter_var(
            Setting::get('settings::modules:ai:enabled', config('modules.ai.enabled', false)),
            FILTER_VALIDATE_BOOLEAN
        );

        if (!$enabled) {
            abort(403, 'The M12Labs-AI module is not enabled.');
        }

        $isPrivileged = $request->user()->root_admin || $request->user()->admin_role_id;

        // Feature-level gating — check the individual component toggle
        $queryType = $request->input('query_type', 'freeform');
        if (!$isPrivileged) {
            if ($queryType === 'log_analysis') {
                $crashEnabled = filter_var(
                    Setting::get('settings::modules:ai:feature_crash_analysis', config('modules.ai.feature_crash_analysis', true)),
                    FILTER_VALIDATE_BOOLEAN
                );
                if (!$crashEnabled) {
                    abort(403, 'AI crash analysis has been disabled by the administrator.');
                }
            } else {
                $assistantEnabled = filter_var(
                    Setting::get('settings::modules:ai:feature_server_assistant', config('modules.ai.feature_server_assistant', true)),
                    FILTER_VALIDATE_BOOLEAN
                );
                if (!$assistantEnabled) {
                    abort(403, 'The AI server assistant has been disabled by the administrator.');
                }
            }
        }

        // Rate limiting: admins get 60 req/10min, regular users get 15 req/10min
        $maxAttempts = $isPrivileged ? 60 : 15;
        $rateLimitKey = 'ai:' . $request->user()->id;

        if (RateLimiter::tooManyAttempts($rateLimitKey, $maxAttempts)) {
            $retryAfter = RateLimiter::availableIn($rateLimitKey);
            return response()->json([
                'error' => 'Too many AI requests. Please try again in ' . $retryAfter . ' seconds.',
                'retry_after' => $retryAfter,
            ], 429);
        }

        RateLimiter::hit($rateLimitKey, 600); // 10-minute window

        $request->validate([
            'query'               => 'required|string|min:1|max:4000',
            'query_type'          => 'nullable|string|in:freeform,log_analysis',
            'conversation_id'     => 'nullable|integer',
            'messages'            => 'nullable|array|max:10',
            'messages.*.role'     => 'required_with:messages|in:user,assistant',
            'messages.*.content'  => 'required_with:messages|string|max:800',
            'stream'              => 'nullable|boolean',
        ]);

        $rawQuery = $request->input('query', '');
        // $queryType already set above for feature gating

        // Multi-turn history — only used for freeform conversations.
        // Log analysis is stateless: the logs ARE the context, so sending prior
        // chat turns just wastes tokens and increases TTFT. We also cap history
        // depth to 6 messages and trim each to 800 chars (prior messages are
        // context clues, not documents — they don't need full content).
        $safeHistory = [];
        if ($queryType === 'freeform') {
            $history = $request->input('messages', []);
            if (is_array($history)) {
                foreach (array_slice($history, -6) as $msg) {
                    if (isset($msg['role'], $msg['content'])
                        && in_array($msg['role'], ['user', 'assistant'], true)
                        && is_string($msg['content'])
                    ) {
                        $safeHistory[] = ['role' => $msg['role'], 'content' => substr($msg['content'], 0, 800)];
                    }
                }
            }
        }

        // Build the context-injected prompt for the final user message, then append to history
        $finalUserContent = $this->buildPrompt($server, $rawQuery, $queryType);
        // Replace the last user message in history with the context-enriched version,
        // or append it if there's no history yet.
        if (!empty($safeHistory) && end($safeHistory)['role'] === 'user') {
            $safeHistory[count($safeHistory) - 1]['content'] = $finalUserContent;
        } else {
            $safeHistory[] = ['role' => 'user', 'content' => $finalUserContent];
        }

        $streamOptions = ['messages' => $safeHistory];

        // Capture values needed inside closures / catch blocks.
        $userId = $request->user()->id;
        $serverUuid = $server->uuid;

        // Verify conversation ownership before accepting the ID to prevent
        // cross-user conversation association in the usage log.
        $conversationId = null;
        if ($request->input('conversation_id')) {
            $rawConvId = (int) $request->input('conversation_id');
            $ownsConversation = \Everest\Models\AiConversation::where('id', $rawConvId)
                ->where('user_id', $userId)
                ->where('server_uuid', $serverUuid)
                ->exists();
            if ($ownsConversation) {
                $conversationId = $rawConvId;
            }
        }
        $model = Setting::get('settings::modules:ai:model', config('modules.ai.model', 'unknown'));

        // Check if streaming is requested
        if ($request->input('stream', false)) {
            return response()->stream(function () use ($streamOptions, $userId, $serverUuid, $conversationId, $model) {
                // Prevent PHP-FPM from killing a long-running AI request and allow
                // the response to finish even if the client disconnects early.
                set_time_limit(0);
                ignore_user_abort(true);

                // Flush an SSE keep-alive comment immediately so nginx/proxies
                // don't 504 while waiting for the first AI token.
                echo ": keep-alive\n\n";
                ob_flush();
                flush();

                $start = microtime(true);
                $status = 'success';
                $errorMsg = null;

                try {
                    foreach ($this->aiService->queryStream('', $streamOptions) as $chunk) {
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
                    Log::error('AI stream error for user ' . $userId . ': ' . $e->getMessage());
                    echo 'data: ' . json_encode(['error' => 'AI service error. Please try again.']) . "\n\n";
                    ob_flush();
                    flush();
                }

                $latencyMs = (int) round((microtime(true) - $start) * 1000);
                try {
                    AiUsageLog::create([
                        'user_id' => $userId,
                        'server_uuid' => $serverUuid,
                        'conversation_id' => $conversationId,
                        'model' => $model,
                        'source' => 'client',
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

        $prompt = $this->buildPrompt($server, $rawQuery, $queryType);
        $start = microtime(true);

        try {
            $result = $this->aiService->query($prompt);
            $latencyMs = (int) round((microtime(true) - $start) * 1000);
            $usage = $this->aiService->getLastUsage();

            try {
                AiUsageLog::create([
                    'user_id' => $userId,
                    'server_uuid' => $serverUuid,
                    'conversation_id' => $conversationId,
                    'model' => $usage['model'] ?? $model,
                    'source' => 'client',
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
                    'user_id' => $userId,
                    'server_uuid' => $serverUuid,
                    'conversation_id' => $conversationId,
                    'model' => $model,
                    'source' => 'client',
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
}

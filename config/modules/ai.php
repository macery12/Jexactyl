<?php

return [
    /*
     * Enable or disable the AI module.
     */
    'enabled' => env('AI_ENABLED', false),

    /*
     * Provider driver: 'anthropic', 'openai', 'openai_compatible' or 'ollama'.
     *
     * Replaces the older 'mode' setting below, which is still read as a
     * fallback so existing installs keep working untouched.
     */
    'provider' => env('AI_PROVIDER', null),

    /*
     * Deprecated. Retained so installs configured before the multi-provider
     * rework continue to resolve a driver. Both of its values ('openai',
     * 'ollama') are still valid provider keys.
     */
    'mode' => env('AI_MODE', 'ollama'),

    /*
     * API key for the configured provider. Stored encrypted at rest.
     * Not required for Ollama or other unauthenticated local endpoints.
     */
    'key' => env('AI_KEY', ''),

    /*
     * API endpoint URL. Left empty, a sensible default for the selected
     * provider is used (see ProviderFactory::DEFAULT_ENDPOINTS).
     */
    'endpoint' => env('AI_ENDPOINT', ''),

    /*
     * Default model, used for any task without a more specific model below.
     */
    'model' => env('AI_MODEL', ''),

    /*
     * Per-task model routing. The agent loop is the only place tool-call
     * reliability matters, so it can run a stronger (or simply different)
     * model than one-shot work like log triage and conversation titles.
     * Either may be left empty to fall back to 'model'.
     */
    'models' => [
        'agent' => env('AI_MODEL_AGENT', ''),
        'fast' => env('AI_MODEL_FAST', ''),
    ],

    /*
     * Maximum tokens generated per response.
     */
    'max_tokens' => env('AI_MAX_TOKENS', 1024),

    /*
     * Temperature for AI responses (0.0 = deterministic, 1.0 = creative).
     * Ignored while tools are on the table — tool selection is pinned to 0.
     */
    'temperature' => env('AI_TEMPERATURE', 0.3),

    /*
     * Hard ceiling on the context window, in tokens. Left null, the model's
     * own reported context length is used where the provider exposes it.
     * Only meaningful for self-hosted providers, where context size is paid
     * for directly in VRAM.
     */
    'context_tokens' => env('AI_CONTEXT_TOKENS', null),

    /*
     * How long Ollama keeps the model loaded after a request.
     * '-1' means never unload — eliminates cold starts at the cost of VRAM.
     */
    'keep_alive' => env('AI_KEEP_ALIVE', '10m'),

    /*
     * Periodically reload the model so the first user of the day does not
     * pay the cold-start penalty. Ollama only.
     */
    'warm' => env('AI_WARM', false),

    /*
     * HTTP timeouts, in seconds. The read timeout is generous because a
     * single agent step on self-hosted hardware can legitimately take minutes.
     */
    'timeout' => env('AI_TIMEOUT', 300),
    'connect_timeout' => env('AI_CONNECT_TIMEOUT', 10),

    /*
     * System prompt for AI.
     */
    'system_prompt' => env('AI_SYSTEM_PROMPT', 'You are an expert game server technician specializing in crash analysis and debugging. When given server logs, identify the root cause concisely and list specific actionable steps to resolve it. Format responses as: Cause: [what went wrong]. Fix: [numbered steps]. For general questions, give direct technical answers. Be concise.'),

    /*
     * Individual feature toggles.
     * These allow disabling specific AI components without disabling AI entirely.
     */
    'feature_server_assistant' => env('AI_FEATURE_SERVER_ASSISTANT', true),
    'feature_crash_analysis' => env('AI_FEATURE_CRASH_ANALYSIS', true),

    /*
     * The agent: tool-calling on behalf of the user. Off by default — it
     * requires a tool-capable model, and the panel refuses to enable it for
     * a model that does not report tool support.
     */
    'agent' => [
        'enabled' => env('AI_AGENT_ENABLED', false),

        /*
         * Hard caps on a single turn. A turn ends when the model stops
         * requesting tools, or when one of these is hit.
         */
        'max_steps' => env('AI_AGENT_MAX_STEPS', 12),
        'max_wall_seconds' => env('AI_AGENT_MAX_WALL_SECONDS', 180),

        /*
         * Tool results are truncated to this many bytes before being fed back
         * to the model. Readers support offset/limit so it can page instead of
         * guessing at what was cut.
         */
        'tool_result_bytes' => env('AI_AGENT_TOOL_RESULT_BYTES', 12288),

        /*
         * How many times a malformed tool call may be re-requested under a
         * schema-constrained grammar before the step is failed.
         */
        'max_repairs' => env('AI_AGENT_MAX_REPAIRS', 2),

        /*
         * Cap on tools exposed in a single request. Small local models degrade
         * sharply past roughly fifteen; the rest are reached through tool groups.
         */
        'max_tools' => env('AI_AGENT_MAX_TOOLS', 15),
    ],

    /*
     * Admission control for self-hosted inference. A GPU serves a fixed number
     * of concurrent requests; beyond that, queueing is dramatically better than
     * thrashing. Ignored for hosted providers, where the binding constraint is
     * spend rather than VRAM.
     */
    'concurrency' => [
        /*
         * Concurrent inference slots. Should match the server's own parallelism
         * (Ollama's OLLAMA_NUM_PARALLEL). Null derives it from the model probe.
         */
        'slots' => env('AI_CONCURRENCY_SLOTS', null),

        /*
         * How many turns may wait for a slot before new requests are refused.
         * Refusing fast is kinder than an unbounded queue nobody reaches the
         * front of.
         */
        'queue_depth' => env('AI_QUEUE_DEPTH', 20),

        /*
         * How long a turn may wait for a slot before giving up.
         */
        'max_wait_seconds' => env('AI_QUEUE_MAX_WAIT', 120),

        /*
         * Concurrent turns per user, so one person cannot occupy every slot.
         */
        'per_user' => env('AI_CONCURRENCY_PER_USER', 1),
    ],

    /*
     * Token budgets. One agent turn is many model calls, so per-request rate
     * limits alone give no meaningful cost ceiling.
     */
    'budget' => [
        'enforce' => env('AI_BUDGET_ENFORCE', false),
        'monthly_tokens' => env('AI_BUDGET_MONTHLY_TOKENS', 2000000),
    ],
];

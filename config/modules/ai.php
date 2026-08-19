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
     * The house system prompt, applied to plain chat and appended to the
     * agent's own instructions.
     *
     * Deliberately plain prose. It has to work unchanged on Anthropic, OpenAI
     * and whatever local model is loaded in Ollama, and a prompt written around
     * one family's conventions travels badly: XML section tags are idiomatic
     * for Claude but confuse models whose chat template treats angle brackets
     * as control tokens, and role assertions ("You are ChatGPT") make a model
     * argue with its own identity. Short matters too — a small local model
     * degrades measurably as the system prompt grows, and the agent stacks this
     * on top of its server facts and tool schemas.
     *
     * It also stays out of output formatting. Crash analysis supplies its own
     * "Issue / Evidence / Fix" shape per request, and an agent turn needs to be
     * free to answer in whatever form the work produced.
     */
    'system_prompt' => env('AI_SYSTEM_PROMPT', 'You are the assistant built into a game server hosting control panel. The people you help run game servers such as Minecraft, Rust and ARK, and range from complete beginners to experienced administrators. Be direct and concrete: lead with the answer, then the reasoning only if it is needed. Prefer exact file paths, setting names and values over general advice. Never invent a file path, configuration key, console command or log line — if you have not seen it, say you are not sure and say how to find out. Match your length to the question, and explain the risk before suggesting anything that deletes data or interrupts players.'),

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
         * The admin assistant, which acts on the panel itself rather than on a
         * server. Gated separately: turning on the customer-facing agent should
         * not silently hand the panel's own controls to a model. Its tools are
         * additionally filtered by the acting administrator's own capabilities,
         * and re-checked on every call.
         */
        'admin_enabled' => env('AI_AGENT_ADMIN_ENABLED', false),

        /*
         * Hard caps on a single turn. A turn ends when the model stops
         * requesting tools, or when one of these is hit.
         */
        'max_steps' => env('AI_AGENT_MAX_STEPS', 12),
        'max_wall_seconds' => env('AI_AGENT_MAX_WALL_SECONDS', 180),

        /*
         * Ceiling on a single tool call.
         *
         * The wall clock above is checked between steps, which is no help at all
         * when the step itself is what stopped: a tool dispatched into a node
         * that has stopped answering blocks until whatever timeout that
         * particular call happens to carry, and some of them are a quarter of an
         * hour. From the user's side that is a spinner that never resolves and no
         * way to tell it apart from a hang.
         *
         * So every tool call runs under this instead, which is deliberately
         * shorter than the turn it sits inside — a tool that overruns fails as a
         * tool, which the model can report or work around, rather than taking the
         * turn down with it.
         *
         * Raise it if a genuinely slow operation (compressing a large world) is
         * being cut off; the agent is not the right way to run those either way.
         */
        'max_tool_seconds' => env('AI_AGENT_MAX_TOOL_SECONDS', 90),

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
         * How many calls one `batch` may carry.
         *
         * A batch is the answer to twenty changes needing twenty approvals: the
         * model writes all of them out, the user reads the set once and approves
         * once, and the whole thing costs a single step. Without it the work is
         * not merely tedious, it is impossible — `max_steps` above is spent long
         * before twenty sequential writes are done, and a resumed turn continues
         * its step count rather than starting over.
         *
         * The ceiling is really a statement about the model: every call in a
         * batch is written in one response, so this is how many complete argument
         * sets it can produce without losing the thread or running into
         * `max_tokens`. A hosted model manages this comfortably; lower it
         * alongside `max_tools` for anything small, where the failure shows up as
         * a malformed call rather than a wrong one.
         */
        'max_batch_calls' => env('AI_AGENT_MAX_BATCH_CALLS', 25),

        /*
         * Whether a batch may contain a destructive call.
         *
         * Off, which means a batch holding one is refused outright and the model
         * is told to ask for it on its own. Not because a single typed
         * confirmation over a listed set is weaker than twenty of them — by the
         * fourth, typing the server's name is muscle memory rather than consent —
         * but because the case batching exists for is bulk creation, and one
         * mistaken click should not be able to take out a dozen things at once.
         *
         * Turn it on if you routinely clear up in bulk. The card still names every
         * target and still demands the typed confirmation once.
         */
        'allow_destructive_batches' => env('AI_AGENT_ALLOW_DESTRUCTIVE_BATCHES', false),

        /*
         * How many complete tool schemas the model is offered in one step.
         *
         * Null means "work it out from the model", which is the default and
         * almost always the right answer. `ToolBudget` reads the size and context
         * window the provider reports and picks a profile: 8 schemas for anything
         * under about 8B, 12 up to about 20B, 20 above that, 32 for a hosted
         * frontier model. Nothing is hidden by a low number — the agent reaches
         * the rest of the catalogue through `search_tools` — so the only thing
         * this trades is a step spent searching against a model's ability to
         * choose correctly between more options.
         *
         * Setting a number overrides the detection outright. Worth doing once you
         * have measured your own model, and worth remembering that the useful
         * direction is usually down: a model that keeps calling the wrong tool is
         * telling you it is being shown too many, and a bigger number will not
         * fix it.
         *
         * The four tools that are always offered — search_tools, load_tools,
         * ask_user, batch — are not counted against this. None of them is a
         * capability, and spending the budget on them would defeat what the
         * budget is for.
         */
        'max_tools' => env('AI_AGENT_MAX_TOOLS'),

        /*
         * Ask the model to reason before it acts, where the model supports it.
         *
         * Two things come out of this: better tool selection, and a visible
         * account of why a step was taken — which is most of what makes a
         * twelve-step turn readable rather than a wall of rows. It costs output
         * tokens and some latency before the first visible word, so it is left
         * switchable. Models that cannot reason ignore it rather than failing.
         */
        'reasoning' => env('AI_AGENT_REASONING', true),
    ],

    /*
     * Keeping personal data out of the request.
     *
     * The panel knows its customers' addresses, their IPs and whatever they
     * typed into a support ticket, and an agent that can read the user table
     * will send all of it to whatever inference endpoint is configured unless
     * something stops it. On by default: an operator who has not thought about
     * this yet is better served by the cautious answer. This is pattern and
     * field-name masking, not de-identification: in particular arbitrary names
     * and postal addresses in prose require external DLP/NER if they must not
     * reach a hosted provider.
     *
     * Applies to tool results and to context the panel attaches by itself —
     * never to what the administrator types, which would break lookup by email
     * for no gain, since they chose to send it.
     */
    'privacy' => [
        'enabled' => env('AI_PRIVACY_REDACT', true),

        /*
         * Which categories are swept. `secret` is absent by default: strings
         * shaped like tokens overlap with backup uuids, file hashes and docker
         * digests that the agent legitimately needs, so it trades capability for
         * safety in a way that should be an operator's decision.
         */
        'categories' => ['email', 'ip', 'name', 'phone', 'address', 'payment'],
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
         * How many turns may hold a queue place before new requests are
         * refused. Refusing fast is kinder than an unbounded queue nobody
         * reaches the front of. A queued turn holds a ticket rather than a PHP
         * worker, so this bounds patience, not the deployment's capacity.
         */
        'queue_depth' => env('AI_QUEUE_DEPTH', 20),

        /*
         * How long a turn may hold its queue place before giving up.
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

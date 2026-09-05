<?php

namespace Everest\Services\AI\Tools\Definitions;

use Everest\Services\AI\Tools\ToolDiscovery;
use Everest\Services\AI\Tools\ToolDefinition;

/**
 * Tools offered on every surface. Host-handled: the runner resolves them itself
 * rather than dispatching an HTTP sub-request, so they have no route, permission
 * or scope of their own.
 *
 * Declared as real definitions rather than synthesised at prompt time, so they
 * appear in the admin catalogue and obey the operator's disable list and risk
 * overrides. The synthesised meta-tool they replace was invisible to the
 * catalogue and impossible to disable or override.
 *
 * The selected core controls are exempt from the working-set budget. Tiny models
 * always get search_tools and ask_user; load_tools and batch remain discoverable
 * but are not paid for in every prompt. Larger profiles receive all four.
 */
class SharedTools
{
    /**
     * Put a question to the user and wait for the answer.
     */
    public const ASK_USER = 'ask_user';

    /**
     * Run several calls behind a single approval.
     */
    public const BATCH = 'batch';

    /**
     * Find tools by name or by what the user is trying to do.
     */
    public const SEARCH_TOOLS = 'search_tools';

    /**
     * Put named tools into the working set, or take them out of it.
     */
    public const LOAD_TOOLS = 'load_tools';

    /**
     * The full core set used above the Tiny profile.
     *
     * Ordered deliberately: discovery first, because a model reading its own tool
     * list top-down should meet the way out of "I have no tool for this" before
     * it meets anything it could misuse instead.
     */
    public const ALWAYS_OFFERED = [
        self::SEARCH_TOOLS,
        self::LOAD_TOOLS,
        self::ASK_USER,
        self::BATCH,
    ];

    /** The minimum navigable surface for models with the Tiny tool budget. */
    public const ESSENTIAL_ALWAYS_OFFERED = [
        self::SEARCH_TOOLS,
        self::ASK_USER,
    ];

    /** @return string[] */
    public static function alwaysOfferedFor(int $capabilityBudget): array
    {
        return $capabilityBudget <= 6
            ? self::ESSENTIAL_ALWAYS_OFFERED
            : self::ALWAYS_OFFERED;
    }

    public const CATEGORY_DISCOVERY = 'discovery';
    public const CATEGORY_CONVERSATION = 'conversation';

    public const CATEGORY_DESCRIPTIONS = [
        self::CATEGORY_DISCOVERY => 'Finding and loading the tools for the task at hand.',
        self::CATEGORY_CONVERSATION => 'Asking the user, and grouping changes for one approval.',
    ];

    /**
     * How many search results the model may ask for at once.
     *
     * The floor is 1 because an exact-name lookup wants exactly one answer. The
     * ceiling is 8 because every result is a candidate for the working set, and a
     * working set that turns over completely on one search is not a working set.
     */
    public const MIN_SEARCH_RESULTS = 1;
    public const MAX_SEARCH_RESULTS = 8;

    /**
     * How many tools one `load_tools` call may name.
     *
     * Generous relative to any real budget: the planner refuses an oversized set
     * outright, with the names, which teaches the model more than a schema error
     * that says only "too many".
     */
    public const MAX_LOAD_TOOLS = 12;

    /**
     * The fewest calls worth batching.
     *
     * A batch of one is not wrong, merely pointless — it runs identically to
     * the call it wraps, having spent a nested schema to get there. Rejecting
     * it costs one retryable round and keeps the model from wrapping
     * everything, which would put the indirection back that offering tools
     * flat exists to remove.
     */
    public const MIN_BATCH_CALLS = 2;

    /**
     * Cap on questions per turn.
     *
     * A question costs a whole step and a full model call, out of a budget of
     * twelve. Left uncapped, a model that is unsure will spend the turn asking
     * instead of looking — which is the same failure the "act, don't narrate"
     * rule exists to prevent, wearing a nicer interface.
     */
    public const MAX_QUESTIONS_PER_TURN = 2;

    /**
     * @return ToolDefinition[]
     */
    public static function all(): array
    {
        return [
            new ToolDefinition(
                name: self::ASK_USER,
                description: 'Ask the user a question and wait for their answer. Use this only when '
                    . 'the answer changes what you would do next and no tool can tell you — never to '
                    . 'confirm something you could look up, and never to announce what you are about '
                    . 'to do. Offer the two to four answers you think most likely; set allow_other '
                    . 'when a reply outside those makes sense.',
                parameters: [
                    'type' => 'object',
                    'properties' => [
                        'question' => [
                            'type' => 'string',
                            'description' => 'The question, in one sentence.',
                        ],
                        'options' => [
                            'type' => 'array',
                            'description' => 'The answers to offer, most likely first.',
                            'minItems' => 2,
                            'maxItems' => 4,
                            'items' => [
                                'type' => 'object',
                                'properties' => [
                                    'label' => [
                                        'type' => 'string',
                                        'description' => 'The answer itself, a few words.',
                                    ],
                                    'description' => [
                                        'type' => 'string',
                                        'description' => 'What choosing this would mean. Optional.',
                                    ],
                                ],
                                'required' => ['label'],
                            ],
                        ],
                        'allow_other' => [
                            'type' => 'boolean',
                            'description' => 'Whether the user may answer in their own words instead.',
                        ],
                    ],
                    'required' => ['question', 'options'],
                ],
                method: '',
                uriTemplate: '',
                // The tier is irrelevant — a host-handled tool never reaches the
                // risk gate's automatic/approval branch, because asking *is* the
                // suspension. Declared SAFE so an operator reading the catalogue
                // is not told this changes anything.
                risk: ToolDefinition::RISK_SAFE,
                scope: ToolDefinition::SCOPE_SHARED,
                discovery: new ToolDiscovery(
                    category: self::CATEGORY_CONVERSATION,
                    aliases: ['ask the user', 'ask a question', 'which one do you want', 'clarify'],
                    tags: ['conversation', 'question'],
                ),
                hostHandled: true,
            ),

            new ToolDefinition(
                name: self::BATCH,
                description: 'Make several changes as one reviewable set. The user is shown every call '
                    . 'in the batch and approves the whole set once, so use this whenever you have two '
                    . 'or more changes of the same kind to make — a range of products to create, a set '
                    . 'of prices to update. Write every argument out in full. A batch is fixed at the '
                    . 'moment it is shown, so no call in it can use what an earlier call returned: if '
                    . 'you need an id one of them produces, make that call on its own first and batch '
                    . 'the rest.',
                parameters: [
                    'type' => 'object',
                    'properties' => [
                        'summary' => [
                            'type' => 'string',
                            'description' => 'What this batch does, in one sentence. The user reads this '
                                . 'before the list, so describe the set rather than the first call.',
                        ],
                        'calls' => [
                            'type' => 'array',
                            'description' => 'The calls to make, in the order they should run.',
                            'minItems' => self::MIN_BATCH_CALLS,
                            'items' => [
                                'type' => 'object',
                                'properties' => [
                                    'tool' => [
                                        'type' => 'string',
                                        'description' => 'The name of the tool to call, exactly as it '
                                            . 'appears in your tool list.',
                                    ],
                                    'arguments' => [
                                        // Free-form on purpose: the arguments are validated against
                                        // the named tool's own schema once it has been resolved,
                                        // which is the only schema that can judge them.
                                        'type' => 'object',
                                        'description' => 'That tool\'s arguments, complete, exactly as '
                                            . 'you would pass them if calling it directly.',
                                    ],
                                ],
                                'required' => ['tool', 'arguments'],
                            ],
                        ],
                        'on_error' => [
                            'type' => 'string',
                            'enum' => ['stop', 'continue'],
                            'description' => 'What to do if one call fails. Use "stop" (the default) '
                                . 'when the calls build on each other, and "continue" when they are '
                                . 'independent and one bad one should not hold up the rest.',
                        ],
                    ],
                    'required' => ['summary', 'calls'],
                ],
                method: '',
                uriTemplate: '',
                // Like ask_user, the declared tier says nothing: a batch is priced
                // by what is inside it, and the runner resolves that per call
                // before the card is drawn. Declared SAFE so an operator reading
                // the catalogue is not told the wrapper itself changes anything.
                risk: ToolDefinition::RISK_SAFE,
                scope: ToolDefinition::SCOPE_SHARED,
                discovery: new ToolDiscovery(
                    category: self::CATEGORY_CONVERSATION,
                    aliases: ['do several things at once', 'make many changes', 'bulk edit', 'all of them'],
                    tags: ['conversation', 'batch', 'bulk'],
                ),
                hostHandled: true,
            ),

            new ToolDefinition(
                name: self::SEARCH_TOOLS,
                description: 'Find a tool. You are given a small working set, not everything you are '
                    . 'allowed to do, so if there is no tool in front of you for what you need, search '
                    . 'for it rather than concluding it does not exist. Describe the task in the words '
                    . 'you would use — "read the startup command", "make a backup" — or pass exact_name '
                    . 'if you already know what the tool is called. Anything found is added to your '
                    . 'tools and can be called on your next step. Searching changes nothing and runs '
                    . 'nothing.',
                parameters: [
                    'type' => 'object',
                    'properties' => [
                        'query' => [
                            'type' => 'string',
                            'description' => 'What you are trying to do, in your own words.',
                        ],
                        'exact_name' => [
                            'type' => 'string',
                            'description' => 'The exact registered name of a tool, if you know it. '
                                . 'Takes priority over query.',
                        ],
                        'limit' => [
                            'type' => 'integer',
                            'minimum' => self::MIN_SEARCH_RESULTS,
                            'maximum' => self::MAX_SEARCH_RESULTS,
                            'description' => 'How many results to return. Fewer is better.',
                        ],
                    ],
                ],
                method: '',
                uriTemplate: '',
                // Genuinely SAFE, unlike the nominal tier on ask_user and batch:
                // this reads a catalogue that was already filtered by the same
                // permission checks that decide what is offered, and executes
                // nothing. A result is a name and one line, never a schema and
                // never data from the panel.
                risk: ToolDefinition::RISK_SAFE,
                scope: ToolDefinition::SCOPE_SHARED,
                discovery: new ToolDiscovery(
                    category: self::CATEGORY_DISCOVERY,
                    aliases: ['find a tool', 'what can you do', 'is there a tool for', 'search tools'],
                    tags: ['discovery', 'search'],
                ),
                hostHandled: true,
            ),

            new ToolDefinition(
                name: self::LOAD_TOOLS,
                description: 'Add tools to your working set by name, or drop ones you have finished '
                    . 'with. Use this when you already know a tool\'s exact name — search_tools is for '
                    . 'when you do not. If a tool needs something first, such as a session on a '
                    . 'customer\'s server, you are told what and it is loaded for you. Loading a tool '
                    . 'never runs it.',
                parameters: [
                    'type' => 'object',
                    'properties' => [
                        'tools' => [
                            'type' => 'array',
                            'description' => 'Exact tool names to load.',
                            'minItems' => 1,
                            'maxItems' => self::MAX_LOAD_TOOLS,
                            'items' => ['type' => 'string'],
                        ],
                        'reason' => [
                            'type' => 'string',
                            'description' => 'Why you need them, in one line.',
                        ],
                        'drop' => [
                            'type' => 'array',
                            'description' => 'Tools you are done with, to make room.',
                            'items' => ['type' => 'string'],
                        ],
                    ],
                    'required' => ['tools'],
                ],
                method: '',
                uriTemplate: '',
                risk: ToolDefinition::RISK_SAFE,
                scope: ToolDefinition::SCOPE_SHARED,
                discovery: new ToolDiscovery(
                    category: self::CATEGORY_DISCOVERY,
                    aliases: ['load a tool', 'get a tool', 'i need the tool called', 'drop a tool'],
                    tags: ['discovery', 'load'],
                ),
                hostHandled: true,
            ),
        ];
    }

    /**
     * Shape the call list the model supplied. Structural only: every entry gets a
     * string `tool` and an array `arguments`, with no judgement about whether
     * either is any good — that needs the named tool's schema and belongs to the
     * runner.
     *
     * Nothing is dropped, deliberately. A malformed entry removed here would run
     * a batch of nineteen while the model believed it asked for twenty.
     *
     * @return array<int, array{tool: string, arguments: array}>
     */
    public static function normaliseCalls(mixed $calls): array
    {
        $normalised = [];

        foreach (is_array($calls) ? $calls : [] as $call) {
            $normalised[] = [
                'tool' => is_array($call) && is_scalar($call['tool'] ?? null)
                    ? trim((string) $call['tool'])
                    : '',
                'arguments' => is_array($call) && is_array($call['arguments'] ?? null)
                    ? $call['arguments']
                    : [],
            ];
        }

        return $normalised;
    }

    /**
     * Normalise the options the model supplied.
     *
     * Schema validation guarantees the shape; this collapses it to the labels
     * and descriptions the UI renders and the resume path validates against,
     * dropping anything blank so an empty button cannot be rendered.
     *
     * @return array<int, array{label: string, description?: string}>
     */
    public static function normaliseOptions(mixed $options): array
    {
        $normalised = [];

        foreach (is_array($options) ? $options : [] as $option) {
            $label = is_array($option) ? trim((string) ($option['label'] ?? '')) : trim((string) $option);

            if ($label === '') {
                continue;
            }

            $entry = ['label' => $label];
            $description = is_array($option) ? trim((string) ($option['description'] ?? '')) : '';

            if ($description !== '') {
                $entry['description'] = $description;
            }

            $normalised[] = $entry;
        }

        return $normalised;
    }
}

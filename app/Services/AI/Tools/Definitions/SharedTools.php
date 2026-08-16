<?php

namespace Everest\Services\AI\Tools\Definitions;

use Everest\Services\AI\Tools\ToolDefinition;

/**
 * Tools offered on every surface.
 *
 * These are host-handled: the runner resolves them itself rather than
 * dispatching an HTTP sub-request, so they have no route, no permission and no
 * scope of their own.
 *
 * They are declared here as real definitions rather than synthesised at prompt
 * time — the way `activate_tool_group` is — so they appear in the admin tool
 * catalogue and obey the operator's disable list and risk overrides like
 * everything else.
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
                hostHandled: true,
            ),
        ];
    }

    /**
     * Shape the call list the model supplied.
     *
     * Structural only — it guarantees every entry has a string `tool` and an
     * array `arguments`, and nothing about whether either is any good. That
     * judgement needs the named tool's own schema and belongs to the runner.
     *
     * Nothing is dropped, deliberately. A malformed entry silently removed here
     * would run a batch of nineteen while the model believed it had asked for
     * twenty, and the card would agree with the wrong one of them.
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

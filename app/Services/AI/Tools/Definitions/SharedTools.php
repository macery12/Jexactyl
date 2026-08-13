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
        ];
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

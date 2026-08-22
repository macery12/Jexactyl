<?php

namespace Everest\Services\AI\Agent;

use Everest\Models\Server;
use Everest\Services\AI\Tools\RiskGate;
use Everest\Services\AI\Tools\ToolRegistry;
use Everest\Services\AI\Tools\ToolDefinition;
use Everest\Services\AI\Tools\Definitions\AdminTools;
use Everest\Services\AI\Tools\Definitions\SharedTools;

/**
 * Extra detail an approval card renders in place of the raw arguments. The card
 * otherwise lists arguments as labelled rows, which reads fine for the
 * self-describing ones; this covers those where the honest rendering is not the
 * argument itself.
 *
 * Kept out of the runner because a pending action outlives its turn: the preview
 * must be rebuildable from the stored tool name and arguments alone.
 */
class ApprovalPreview
{
    /**
     * @return array<string, mixed>|null
     */
    public static function for(string $toolName, array $arguments, ?Server $target = null): ?array
    {
        if ($target !== null && $toolName === 'console_send') {
            return self::confirmationTarget($target);
        }

        return match ($toolName) {
            'files_write' => self::diff($arguments),
            AdminTools::ASSIST_SERVER => self::assistTarget($arguments),
            SharedTools::BATCH => self::batch($arguments),
            default => null,
        };
    }

    /** @return array{kind: string, name: string, identifier: string} */
    private static function confirmationTarget(Server $server): array
    {
        return [
            'kind' => 'confirmation',
            'name' => (string) $server->name,
            'identifier' => (string) $server->uuidShort,
        ];
    }

    /**
     * The calls a batch will make, as a list rather than a nested blob. The most
     * important preview here: a batch is the one card whose arguments are
     * themselves tool calls, and rendering them as arguments gives a wall of JSON
     * nobody reads — losing the review quality batching was meant to preserve.
     *
     * Each call's arguments pass through untouched for the frontend's usual
     * renderer, and each carries its own tier, which tells the card what must be
     * read before approving. Tiers are resolved live rather than stored, since an
     * operator may have hardened a tool since the card was drawn.
     *
     * `summary` travels but is the model's own words, and the card labels it as
     * such.
     *
     * @return array{kind: string, summary: string, count: int, requires_review: int, calls: array<int, array{tool: string, arguments: array, risk: string}>}|null
     */
    private static function batch(array $arguments): ?array
    {
        $calls = SharedTools::normaliseCalls($arguments['calls'] ?? []);

        if ($calls === []) {
            return null;
        }

        $registry = app(ToolRegistry::class);
        $gate = app(RiskGate::class);
        $requiresReview = 0;

        foreach ($calls as $index => $call) {
            $definition = $call['tool'] === '' ? null : $registry->find($call['tool']);

            // An unresolvable child cannot be shown as safe. It will be refused
            // at execution, and until then the honest presentation of "no idea
            // what this is" is the tier that demands a look.
            $risk = $definition === null
                ? ToolDefinition::RISK_DESTRUCTIVE
                : $gate->resolve($definition, $call['arguments']);

            $calls[$index]['risk'] = $risk;

            if ($risk !== ToolDefinition::RISK_SAFE) {
                ++$requiresReview;
            }
        }

        return [
            'kind' => 'batch',
            'summary' => trim((string) ($arguments['summary'] ?? '')),
            'count' => count($calls),
            // How many children the card must see opened before it will let the
            // set be approved.
            'requires_review' => $requiresReview,
            'calls' => array_values($calls),
        ];
    }

    /**
     * A file write is the one case where the argument is unreadable as text:
     * nobody can approve four kilobytes of TOML by eye, but everyone can read
     * three changed lines.
     *
     * @return array{kind: string, file: ?string, original: string, updated: string}
     */
    private static function diff(array $arguments): array
    {
        return [
            'kind' => 'diff',
            'file' => isset($arguments['file']) ? (string) $arguments['file'] : null,
            'original' => (string) ($arguments['original_content'] ?? ''),
            'updated' => (string) ($arguments['content'] ?? ''),
        ];
    }

    /**
     * Whose server this actually is. The argument arrives as `"2"` or a bare
     * uuid, and an id is not something anyone can weigh — so it is resolved once
     * into the name and owner the decision is really about, since the
     * administrator is being asked to enter a paying customer's server.
     *
     * An unresolvable reference returns null rather than erroring: the card falls
     * back to the raw argument, and the call fails as it always did.
     *
     * @return array{kind: string, name: string, owner: ?string, identifier: string}|null
     */
    private static function assistTarget(array $arguments): ?array
    {
        $reference = trim((string) ($arguments['server'] ?? ''));

        if ($reference === '') {
            return null;
        }

        $server = app(AssistAuthorizer::class)->resolveServer($reference);

        if ($server === null) {
            return null;
        }

        return [
            'kind' => 'server',
            'name' => (string) $server->name,
            // `servers.owner_id` is non-null and protected by a foreign key, so
            // a server cannot outlive its owner.
            'owner' => $server->user->username,
            'identifier' => (string) $server->uuidShort,
        ];
    }
}

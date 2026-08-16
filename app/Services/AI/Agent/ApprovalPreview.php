<?php

namespace Everest\Services\AI\Agent;

use Everest\Services\AI\Tools\Definitions\AdminTools;
use Everest\Services\AI\Tools\Definitions\SharedTools;

/**
 * Extra detail an approval card renders in place of the raw arguments.
 *
 * The card falls back to listing arguments as labelled rows, which is readable
 * for most tools because most arguments are self-describing — a path, a signal, a
 * sentence. This exists for the ones that are not, where the honest rendering of
 * the argument is not the argument itself.
 *
 * Kept out of the runner because a pending action outlives the turn that created
 * it: the preview has to be rebuildable from the stored tool name and arguments
 * alone when the user comes back to an approval minutes later.
 */
class ApprovalPreview
{
    /**
     * @return array<string, mixed>|null
     */
    public static function for(string $toolName, array $arguments): ?array
    {
        return match ($toolName) {
            'files_write' => self::diff($arguments),
            AdminTools::ASSIST_SERVER => self::assistTarget($arguments),
            SharedTools::BATCH => self::batch($arguments),
            default => null,
        };
    }

    /**
     * The calls a batch will make, as a list rather than a nested blob.
     *
     * The single most important preview here, because a batch is the one card
     * whose arguments are themselves tool calls: rendered as arguments they are
     * a wall of nested JSON, and a wall of JSON is a card nobody reads — which
     * would give back exactly the review quality that batching one approval
     * instead of twenty was meant to preserve.
     *
     * Kept deliberately thin. The risk tier travels because the card colours
     * rows by it, but each call's arguments are passed through untouched for the
     * frontend to lay out with the same renderer a single-call card uses.
     *
     * @return array{kind: string, summary: string, count: int, calls: array<int, array{tool: string, arguments: array}>}|null
     */
    private static function batch(array $arguments): ?array
    {
        $calls = SharedTools::normaliseCalls($arguments['calls'] ?? []);

        if ($calls === []) {
            return null;
        }

        return [
            'kind' => 'batch',
            'summary' => trim((string) ($arguments['summary'] ?? '')),
            'count' => count($calls),
            'calls' => $calls,
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
     * Whose server this actually is.
     *
     * The model names a server by whatever identifier it happened to read off a
     * listing, so the argument arrives as `"2"` or a bare uuid. That is the one
     * fact the approval turns on — the administrator is being asked to enter a
     * paying customer's server, and an id is not something anyone can weigh. So
     * it is resolved here, once, into the name and owner the decision is really
     * about.
     *
     * A reference that resolves to nothing returns null rather than an error:
     * the card falls back to showing the raw argument, and the call itself fails
     * the same way it always did, with a message the model can act on.
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
            // Nullable because the relation can be missing on a server whose
            // owner was deleted, which is exactly the sort of orphan somebody
            // opens a diagnostic session about.
            'owner' => $server->user?->username,
            'identifier' => (string) $server->uuidShort,
        ];
    }
}

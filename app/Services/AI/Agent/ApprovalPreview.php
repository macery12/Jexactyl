<?php

namespace Everest\Services\AI\Agent;

/**
 * Extra detail an approval card renders alongside the raw arguments.
 *
 * Kept out of the runner because a pending action outlives the turn that
 * created it: the preview has to be rebuildable from the stored tool name and
 * arguments alone when the user comes back to an approval minutes later.
 */
class ApprovalPreview
{
    /**
     * @return array{kind: string, file: ?string, original: string, updated: string}|null
     */
    public static function for(string $toolName, array $arguments): ?array
    {
        // A file write is the one case where the argument is unreadable as
        // text: nobody can approve four kilobytes of TOML by eye, but everyone
        // can read three changed lines.
        if ($toolName !== 'files_write') {
            return null;
        }

        return [
            'kind' => 'diff',
            'file' => isset($arguments['file']) ? (string) $arguments['file'] : null,
            'original' => (string) ($arguments['original_content'] ?? ''),
            'updated' => (string) ($arguments['content'] ?? ''),
        ];
    }
}

<?php

namespace Everest\Services\Files;

class FileDiffService
{
    /**
     * Text file extensions that support diff comparison.
     */
    public const TEXT_EXTENSIONS = [
        'txt', 'md', 'markdown', 'json', 'yaml', 'yml', 'xml',
        'html', 'htm', 'css', 'scss', 'sass', 'less',
        'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
        'php', 'py', 'rb', 'java', 'c', 'cpp', 'h', 'hpp',
        'cs', 'go', 'rs', 'swift', 'kt', 'scala',
        'sh', 'bash', 'zsh', 'fish', 'ps1', 'bat', 'cmd',
        'sql', 'lua', 'pl', 'pm', 'r', 'R',
        'toml', 'ini', 'cfg', 'conf', 'config', 'env', 'properties',
        'htaccess', 'gitignore', 'dockerignore', 'editorconfig',
        'vue', 'svelte', 'astro',
        'log', 'csv', 'tsv',
        'Dockerfile', 'Makefile', 'Rakefile', 'Gemfile',
        'gradle', 'sbt', 'pom',
    ];

    /**
     * Detailed diffs are optional audit metadata. Larger inputs still receive a
     * constant-memory summary and never enter the line comparison algorithm.
     */
    public const MAX_DIFF_SIZE = 512 * 1024;

    public const MAX_DIFF_LINES = 2000;

    /**
     * Maximum logical old-lines × new-lines comparison area. Unlike the old
     * implementation, this many cells are never allocated as a PHP matrix.
     */
    public const MAX_DIFF_CELLS = 250000;

    /**
     * Hard backstop for line comparisons and split scans performed by the
     * bounded-memory Hirschberg implementation.
     */
    public const MAX_DIFF_WORK_UNITS = 1000000;

    /**
     * Activity records have their own limits so a valid input cannot create an
     * oversized JSON/database payload.
     */
    public const MAX_LOGGED_HUNKS = 50;

    public const MAX_LOGGED_CHANGES = 500;

    public const MAX_LOGGED_CONTENT_BYTES = 64 * 1024;

    /**
     * Check if a file is a text file based on its extension.
     */
    public function isTextFile(string $filename): bool
    {
        $extension = strtolower(pathinfo($filename, PATHINFO_EXTENSION));
        $basename = basename($filename);

        // Check if it's a common config file without extension.
        if (in_array($basename, ['Dockerfile', 'Makefile', 'Rakefile', 'Gemfile', '.env', '.gitignore', '.dockerignore', '.editorconfig', '.htaccess', '.pteroignore'], true)) {
            return true;
        }

        return in_array($extension, self::TEXT_EXTENSIONS, true);
    }

    /**
     * Calculate a bounded diff between original and new content.
     */
    public function calculateDiff(string $originalContent, string $newContent, string $filename): array
    {
        $originalLineCount = $this->lineCount($originalContent);
        $newLineCount = $this->lineCount($newContent);

        if (
            strlen($originalContent) > self::MAX_DIFF_SIZE
            || strlen($newContent) > self::MAX_DIFF_SIZE
            || $originalLineCount > self::MAX_DIFF_LINES
            || $newLineCount > self::MAX_DIFF_LINES
        ) {
            return $this->createLargeDiffSummary($originalContent, $newContent, $filename);
        }

        $originalLines = $this->splitLines($originalContent);
        $newLines = $this->splitLines($newContent);
        $oldLength = count($originalLines);
        $newLength = count($newLines);

        if (
            $oldLength > 0
            && $newLength > intdiv(self::MAX_DIFF_CELLS, $oldLength)
        ) {
            return $this->createLargeDiffSummary($originalContent, $newContent, $filename);
        }

        $remainingWork = self::MAX_DIFF_WORK_UNITS;
        $lcs = $this->longestCommonSubsequence($originalLines, $newLines, $remainingWork);
        if ($lcs === null) {
            return $this->createLargeDiffSummary($originalContent, $newContent, $filename);
        }

        $changes = $this->buildChangeList($originalLines, $newLines, $lcs);
        [$hunks, $logTruncated] = $this->applyLogBudget(
            $this->groupChangesIntoHunks($changes)
        );

        return [
            'file' => $filename,
            'additions' => $newLength - count($lcs),
            'deletions' => $oldLength - count($lcs),
            'hunks' => $hunks,
            'original_lines' => $oldLength,
            'new_lines' => $newLength,
            'is_new_file' => $originalContent === '',
            'log_truncated' => $logTruncated,
        ];
    }

    /**
     * Create a constant-memory summary when a detailed diff is outside budget.
     */
    private function createLargeDiffSummary(string $originalContent, string $newContent, string $filename): array
    {
        $originalLines = $this->lineCount($originalContent);
        $newLines = $this->lineCount($newContent);

        return [
            'file' => $filename,
            'additions' => max(0, $newLines - $originalLines),
            'deletions' => max(0, $originalLines - $newLines),
            'hunks' => [],
            'original_lines' => $originalLines,
            'new_lines' => $newLines,
            'is_new_file' => $originalContent === '',
            'large_file' => true,
            'log_truncated' => false,
        ];
    }

    private function lineCount(string $content): int
    {
        return $content === '' ? 0 : substr_count($content, "\n") + 1;
    }

    /**
     * @return list<string>
     */
    private function splitLines(string $content): array
    {
        return $content === '' ? [] : explode("\n", $content);
    }

    /**
     * Compute an LCS using Hirschberg's divide-and-conquer algorithm. It uses a
     * single integer row rather than a full O(old × new) PHP array matrix.
     *
     * @param list<string> $old
     * @param list<string> $new
     *
     * @return list<array{old: int, new: int, line: string}>|null
     */
    private function longestCommonSubsequence(array $old, array $new, int &$remainingWork): ?array
    {
        $swapped = count($new) > count($old);
        $first = $swapped ? $new : $old;
        $second = $swapped ? $old : $new;

        $pairs = $this->hirschberg(
            $first,
            0,
            count($first),
            $second,
            0,
            count($second),
            $remainingWork
        );

        if ($pairs === null) {
            return null;
        }

        $lcs = [];
        foreach ($pairs as $pair) {
            $oldIndex = $swapped ? $pair['second'] : $pair['first'];
            $newIndex = $swapped ? $pair['first'] : $pair['second'];
            $lcs[] = [
                'old' => $oldIndex,
                'new' => $newIndex,
                'line' => $old[$oldIndex],
            ];
        }

        return $lcs;
    }

    /**
     * @param list<string> $first
     * @param list<string> $second
     *
     * @return list<array{first: int, second: int}>|null
     */
    private function hirschberg(
        array $first,
        int $firstStart,
        int $firstLength,
        array $second,
        int $secondStart,
        int $secondLength,
        int &$remainingWork,
    ): ?array {
        if ($firstLength === 0 || $secondLength === 0) {
            return [];
        }

        if ($firstLength === 1) {
            for ($offset = 0; $offset < $secondLength; ++$offset) {
                if (!$this->consumeWorkUnit($remainingWork)) {
                    return null;
                }

                $secondIndex = $secondStart + $offset;
                if ($first[$firstStart] === $second[$secondIndex]) {
                    return [[
                        'first' => $firstStart,
                        'second' => $secondIndex,
                    ]];
                }
            }

            return [];
        }

        $firstLeftLength = intdiv($firstLength, 2);
        $firstRightStart = $firstStart + $firstLeftLength;
        $firstRightLength = $firstLength - $firstLeftLength;

        $prefix = $this->lcsPrefixLengths(
            $first,
            $firstStart,
            $firstLeftLength,
            $second,
            $secondStart,
            $secondLength,
            $remainingWork
        );
        if ($prefix === null) {
            return null;
        }

        $suffix = $this->lcsSuffixLengths(
            $first,
            $firstRightStart,
            $firstRightLength,
            $second,
            $secondStart,
            $secondLength,
            $remainingWork
        );
        if ($suffix === null) {
            return null;
        }

        $split = 0;
        $bestLength = -1;
        for ($offset = 0; $offset <= $secondLength; ++$offset) {
            if (!$this->consumeWorkUnit($remainingWork)) {
                return null;
            }

            $candidate = $prefix[$offset] + $suffix[$offset];
            if ($candidate > $bestLength) {
                $bestLength = $candidate;
                $split = $offset;
            }
        }

        $left = $this->hirschberg(
            $first,
            $firstStart,
            $firstLeftLength,
            $second,
            $secondStart,
            $split,
            $remainingWork
        );
        if ($left === null) {
            return null;
        }

        $right = $this->hirschberg(
            $first,
            $firstRightStart,
            $firstRightLength,
            $second,
            $secondStart + $split,
            $secondLength - $split,
            $remainingWork
        );
        if ($right === null) {
            return null;
        }

        foreach ($right as $pair) {
            $left[] = $pair;
        }

        return $left;
    }

    /**
     * @param list<string> $first
     * @param list<string> $second
     *
     * @return list<int>|null
     */
    private function lcsPrefixLengths(
        array $first,
        int $firstStart,
        int $firstLength,
        array $second,
        int $secondStart,
        int $secondLength,
        int &$remainingWork,
    ): ?array {
        $row = array_fill(0, $secondLength + 1, 0);

        for ($firstOffset = 0; $firstOffset < $firstLength; ++$firstOffset) {
            $diagonal = 0;
            for ($secondOffset = 0; $secondOffset < $secondLength; ++$secondOffset) {
                if (!$this->consumeWorkUnit($remainingWork)) {
                    return null;
                }

                $above = $row[$secondOffset + 1];
                if ($first[$firstStart + $firstOffset] === $second[$secondStart + $secondOffset]) {
                    $row[$secondOffset + 1] = $diagonal + 1;
                } else {
                    $row[$secondOffset + 1] = max($above, $row[$secondOffset]);
                }
                $diagonal = $above;
            }
        }

        return $row;
    }

    /**
     * Return LCS lengths for every suffix of the second range.
     *
     * @param list<string> $first
     * @param list<string> $second
     *
     * @return list<int>|null
     */
    private function lcsSuffixLengths(
        array $first,
        int $firstStart,
        int $firstLength,
        array $second,
        int $secondStart,
        int $secondLength,
        int &$remainingWork,
    ): ?array {
        $row = array_fill(0, $secondLength + 1, 0);

        for ($firstOffset = $firstLength - 1; $firstOffset >= 0; --$firstOffset) {
            $diagonal = 0;
            for ($secondOffset = $secondLength - 1; $secondOffset >= 0; --$secondOffset) {
                if (!$this->consumeWorkUnit($remainingWork)) {
                    return null;
                }

                $below = $row[$secondOffset];
                if ($first[$firstStart + $firstOffset] === $second[$secondStart + $secondOffset]) {
                    $row[$secondOffset] = $diagonal + 1;
                } else {
                    $row[$secondOffset] = max($below, $row[$secondOffset + 1]);
                }
                $diagonal = $below;
            }
        }

        return $row;
    }

    private function consumeWorkUnit(int &$remainingWork): bool
    {
        if ($remainingWork <= 0) {
            return false;
        }

        --$remainingWork;

        return true;
    }

    /**
     * Build additions, deletions, and context entries from the LCS.
     *
     * @param list<string> $oldLines
     * @param list<string> $newLines
     * @param list<array{old: int, new: int, line: string}> $lcs
     *
     * @return list<array{type: string, content: string, old_line: int|null, new_line: int|null}>
     */
    private function buildChangeList(array $oldLines, array $newLines, array $lcs): array
    {
        $changes = [];
        $oldIndex = 0;
        $newIndex = 0;

        foreach ($lcs as $lcsItem) {
            while ($oldIndex < $lcsItem['old']) {
                $changes[] = [
                    'type' => 'deletion',
                    'content' => $oldLines[$oldIndex],
                    'old_line' => $oldIndex + 1,
                    'new_line' => null,
                ];
                ++$oldIndex;
            }

            while ($newIndex < $lcsItem['new']) {
                $changes[] = [
                    'type' => 'addition',
                    'content' => $newLines[$newIndex],
                    'old_line' => null,
                    'new_line' => $newIndex + 1,
                ];
                ++$newIndex;
            }

            $changes[] = [
                'type' => 'context',
                'content' => $lcsItem['line'],
                'old_line' => $oldIndex + 1,
                'new_line' => $newIndex + 1,
            ];
            ++$oldIndex;
            ++$newIndex;
        }

        $oldLength = count($oldLines);
        while ($oldIndex < $oldLength) {
            $changes[] = [
                'type' => 'deletion',
                'content' => $oldLines[$oldIndex],
                'old_line' => $oldIndex + 1,
                'new_line' => null,
            ];
            ++$oldIndex;
        }

        $newLength = count($newLines);
        while ($newIndex < $newLength) {
            $changes[] = [
                'type' => 'addition',
                'content' => $newLines[$newIndex],
                'old_line' => null,
                'new_line' => $newIndex + 1,
            ];
            ++$newIndex;
        }

        return $changes;
    }

    /**
     * Group changes into three-context-line hunks.
     *
     * @param list<array{type: string, content: string, old_line: int|null, new_line: int|null}> $changes
     */
    private function groupChangesIntoHunks(array $changes, int $contextLines = 3): array
    {
        $ranges = [];
        $lastIndex = count($changes) - 1;

        foreach ($changes as $index => $change) {
            if ($change['type'] === 'context') {
                continue;
            }

            $start = max(0, $index - $contextLines);
            $end = min($lastIndex, $index + $contextLines);
            $lastRange = array_key_last($ranges);

            if ($lastRange !== null && $start <= $ranges[$lastRange]['end'] + 1) {
                $ranges[$lastRange]['end'] = max($ranges[$lastRange]['end'], $end);
            } else {
                $ranges[] = ['start' => $start, 'end' => $end];
            }
        }

        $hunks = [];
        foreach ($ranges as $range) {
            $hunk = [
                'old_start' => null,
                'old_lines' => 0,
                'new_start' => null,
                'new_lines' => 0,
                'context' => '',
                'changes' => [],
            ];

            for ($index = $range['start']; $index <= $range['end']; ++$index) {
                $change = $changes[$index];
                if ($hunk['old_start'] === null && $change['old_line'] !== null) {
                    $hunk['old_start'] = $change['old_line'];
                }
                if ($hunk['new_start'] === null && $change['new_line'] !== null) {
                    $hunk['new_start'] = $change['new_line'];
                }

                $hunk['changes'][] = [
                    'type' => $change['type'],
                    'content' => $change['content'],
                ];

                if ($change['type'] !== 'addition') {
                    ++$hunk['old_lines'];
                }
                if ($change['type'] !== 'deletion') {
                    ++$hunk['new_lines'];
                }
            }

            $hunk['old_start'] ??= 1;
            $hunk['new_start'] ??= 1;
            $hunks[] = $hunk;
        }

        return $hunks;
    }

    /**
     * @return array{array, bool}
     */
    private function applyLogBudget(array $hunks): array
    {
        $limited = [];
        $loggedChanges = 0;
        $loggedBytes = 0;
        $truncated = false;
        $stop = false;

        foreach ($hunks as $hunk) {
            if (count($limited) >= self::MAX_LOGGED_HUNKS) {
                $truncated = true;
                break;
            }

            $changes = [];
            $oldLines = 0;
            $newLines = 0;

            foreach ($hunk['changes'] as $change) {
                if ($loggedChanges >= self::MAX_LOGGED_CHANGES) {
                    $truncated = true;
                    $stop = true;
                    break;
                }

                $remainingBytes = self::MAX_LOGGED_CONTENT_BYTES - $loggedBytes;
                if ($remainingBytes <= 0 && $change['content'] !== '') {
                    $truncated = true;
                    $stop = true;
                    break;
                }

                $content = $change['content'];
                if (strlen($content) > $remainingBytes) {
                    $content = mb_strcut($content, 0, $remainingBytes, 'UTF-8');
                    $truncated = true;
                    $stop = true;
                }

                $changes[] = [
                    'type' => $change['type'],
                    'content' => $content,
                ];
                ++$loggedChanges;
                $loggedBytes += strlen($content);

                if ($change['type'] !== 'addition') {
                    ++$oldLines;
                }
                if ($change['type'] !== 'deletion') {
                    ++$newLines;
                }

                if ($stop) {
                    break;
                }
            }

            if ($changes !== []) {
                $hunk['changes'] = $changes;
                $hunk['old_lines'] = $oldLines;
                $hunk['new_lines'] = $newLines;
                $limited[] = $hunk;
            }

            if ($stop) {
                break;
            }
        }

        return [$limited, $truncated];
    }
}

<?php

namespace Everest\Tests\Unit\Services\Files;

use PHPUnit\Framework\TestCase;
use Everest\Services\Files\FileDiffService;

class FileDiffServiceTest extends TestCase
{
    private FileDiffService $service;

    protected function setUp(): void
    {
        parent::setUp();

        $this->service = new FileDiffService();
    }

    public function testItCalculatesAUsefulDetailedDiff(): void
    {
        $diff = $this->service->calculateDiff(
            "alpha\nbefore\nomega",
            "alpha\nafter\nomega",
            'server.properties'
        );

        $this->assertSame(1, $diff['additions']);
        $this->assertSame(1, $diff['deletions']);
        $this->assertFalse($diff['log_truncated']);
        $this->assertArrayNotHasKey('large_file', $diff);
        $this->assertSame(
            ['context', 'deletion', 'addition', 'context'],
            array_column($diff['hunks'][0]['changes'], 'type')
        );
    }

    public function testEmptyContentIsTreatedAsZeroLines(): void
    {
        $created = $this->service->calculateDiff('', 'first line', 'notes.txt');
        $deleted = $this->service->calculateDiff('first line', '', 'notes.txt');

        $this->assertSame(1, $created['additions']);
        $this->assertSame(0, $created['deletions']);
        $this->assertSame(0, $created['original_lines']);
        $this->assertTrue($created['is_new_file']);

        $this->assertSame(0, $deleted['additions']);
        $this->assertSame(1, $deleted['deletions']);
        $this->assertSame(0, $deleted['new_lines']);
    }

    public function testLogicalCellBudgetSkipsAdversarialDetailedComparison(): void
    {
        $old = implode("\n", array_map(fn (int $index) => 'old-' . $index, range(1, 501)));
        $new = implode("\n", array_map(fn (int $index) => 'new-' . $index, range(1, 501)));

        $diff = $this->service->calculateDiff($old, $new, 'large.txt');

        $this->assertTrue($diff['large_file']);
        $this->assertSame([], $diff['hunks']);
    }

    public function testLineBudgetSkipsComparisonBeforeSplittingIntoDetailedDiff(): void
    {
        $content = str_repeat("line\n", FileDiffService::MAX_DIFF_LINES);

        $diff = $this->service->calculateDiff($content, $content, 'many-lines.txt');

        $this->assertTrue($diff['large_file']);
        $this->assertSame(FileDiffService::MAX_DIFF_LINES + 1, $diff['original_lines']);
    }

    public function testLoggedContentIsTruncatedAtTheExplicitByteBudget(): void
    {
        $old = str_repeat('a', FileDiffService::MAX_LOGGED_CONTENT_BYTES + 100);
        $new = str_repeat('b', FileDiffService::MAX_LOGGED_CONTENT_BYTES + 100);

        $diff = $this->service->calculateDiff($old, $new, 'long-line.txt');
        $loggedBytes = 0;
        foreach ($diff['hunks'] as $hunk) {
            foreach ($hunk['changes'] as $change) {
                $loggedBytes += strlen($change['content']);
            }
        }

        $this->assertTrue($diff['log_truncated']);
        $this->assertLessThanOrEqual(FileDiffService::MAX_LOGGED_CONTENT_BYTES, $loggedBytes);
    }

    public function testLoggedChangeCountIsBoundedWithoutLosingAggregateCounts(): void
    {
        $old = implode("\n", array_map(fn (int $index) => 'old-' . $index, range(1, 300)));
        $new = implode("\n", array_map(fn (int $index) => 'new-' . $index, range(1, 300)));

        $diff = $this->service->calculateDiff($old, $new, 'replaced.txt');
        $loggedChanges = array_sum(array_map(
            fn (array $hunk) => count($hunk['changes']),
            $diff['hunks']
        ));

        $this->assertSame(300, $diff['additions']);
        $this->assertSame(300, $diff['deletions']);
        $this->assertTrue($diff['log_truncated']);
        $this->assertLessThanOrEqual(FileDiffService::MAX_LOGGED_CHANGES, $loggedChanges);
    }

    public function testLoggedHunkCountIsBounded(): void
    {
        $oldLines = [];
        $newLines = [];
        for ($index = 0; $index < 408; ++$index) {
            $oldLines[] = 'same-' . $index;
            $newLines[] = $index % 8 === 0 ? 'changed-' . $index : 'same-' . $index;
        }

        $diff = $this->service->calculateDiff(
            implode("\n", $oldLines),
            implode("\n", $newLines),
            'many-hunks.txt'
        );

        $this->assertArrayNotHasKey('large_file', $diff);
        $this->assertTrue($diff['log_truncated']);
        $this->assertLessThanOrEqual(FileDiffService::MAX_LOGGED_HUNKS, count($diff['hunks']));
    }

    public function testTextFileDetectionIsStrict(): void
    {
        $this->assertTrue($this->service->isTextFile('/srv/.env'));
        $this->assertTrue($this->service->isTextFile('/srv/config.PHP'));
        $this->assertFalse($this->service->isTextFile('/srv/archive.zip'));
    }
}

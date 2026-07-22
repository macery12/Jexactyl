<?php

namespace Everest\Tests\Unit\Services\Extensions;

use Everest\Tests\TestCase;
use Everest\Services\Extensions\PanelVersionCompatibilityService;

class PanelVersionCompatibilityServiceTest extends TestCase
{
    private PanelVersionCompatibilityService $service;

    public function setUp(): void
    {
        parent::setUp();

        $this->service = new PanelVersionCompatibilityService();
    }

    public function testEmptyDeclarationIsAlwaysCompatible(): void
    {
        $this->assertTrue($this->service->satisfiedBy('Alpha 3.0', []));
        $this->assertTrue($this->service->satisfiedBy('Alpha 3.0', [null, 42]));
    }

    public function testExactMatchStillWorks(): void
    {
        $this->assertTrue($this->service->satisfiedBy('Alpha 3.0', ['Alpha 3.0']));
        $this->assertTrue($this->service->satisfiedBy('Alpha 3.0', ['Alpha 2.0', 'Alpha 3.0']));
        $this->assertFalse($this->service->satisfiedBy('Alpha 3.1', ['Alpha 3.0']));
    }

    public function testRangeWithStageWords(): void
    {
        $range = ['>=Alpha 3.0 <Alpha 4.0'];

        $this->assertTrue($this->service->satisfiedBy('Alpha 3.0', $range));
        $this->assertTrue($this->service->satisfiedBy('Alpha 3.5', $range));
        $this->assertTrue($this->service->satisfiedBy('Alpha 3.5.2', $range));
        $this->assertFalse($this->service->satisfiedBy('Alpha 4.0', $range));
        $this->assertFalse($this->service->satisfiedBy('Alpha 2.9', $range));
    }

    public function testCaretAndWildcardConstraints(): void
    {
        $this->assertTrue($this->service->satisfiedBy('Alpha 3.2', ['^3.0']));
        $this->assertFalse($this->service->satisfiedBy('Alpha 4.0', ['^3.0']));

        $this->assertTrue($this->service->satisfiedBy('Alpha 3.9', ['3.x']));
        $this->assertFalse($this->service->satisfiedBy('Alpha 4.0', ['3.x']));
    }

    public function testReleaseStagesOrderCorrectly(): void
    {
        // alpha < beta < stable within the same number.
        $this->assertFalse($this->service->satisfiedBy('Alpha 3.0', ['>=Beta 3.0']));
        $this->assertTrue($this->service->satisfiedBy('Beta 3.0', ['>=Alpha 3.0 <Alpha 4.0']));
        $this->assertTrue($this->service->satisfiedBy('3.0', ['>=Beta 3.0']));
    }

    public function testAnyMatchingEntryWins(): void
    {
        $this->assertTrue($this->service->satisfiedBy('Alpha 3.5', ['Alpha 2.0', '>=Alpha 3.0 <Alpha 4.0']));
    }

    public function testUnparseableEntriesNeverMatch(): void
    {
        $this->assertFalse($this->service->satisfiedBy('Alpha 3.0', ['not a version']));
        $this->assertTrue($this->service->satisfiedBy('Alpha 3.0', ['not a version', '^3.0']));
    }

    public function testUnparseablePanelVersionOnlyMatchesExactly(): void
    {
        $this->assertTrue($this->service->satisfiedBy('Custom Build', ['Custom Build']));
        $this->assertFalse($this->service->satisfiedBy('Custom Build', ['>=3.0']));
    }
}

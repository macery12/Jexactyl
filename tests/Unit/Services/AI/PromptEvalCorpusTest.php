<?php

namespace Everest\Tests\Unit\Services\AI;

use PHPUnit\Framework\TestCase;

/** Keeps the incident-derived semantic eval corpus complete and machine-readable. */
class PromptEvalCorpusTest extends TestCase
{
    public function testCorpusHasUniqueCompleteCasesAndZeroToleranceCoverage(): void
    {
        $json = file_get_contents(dirname(__DIR__, 3) . '/Fixtures/ai-agent-prompt-evals.json');
        $corpus = json_decode((string) $json, true, flags: JSON_THROW_ON_ERROR);

        $this->assertSame(1, $corpus['version']);
        $this->assertGreaterThanOrEqual(30, count($corpus['cases']));

        $ids = [];
        $coveredTags = [];

        foreach ($corpus['cases'] as $case) {
            foreach (['id', 'surface', 'request', 'given', 'expected', 'forbidden', 'tags'] as $field) {
                $this->assertArrayHasKey($field, $case, sprintf('%s is missing %s', $case['id'] ?? 'case', $field));
            }

            $this->assertNotContains($case['id'], $ids, 'Eval ids must be unique.');
            $this->assertNotEmpty($case['expected']);
            $this->assertNotEmpty($case['forbidden']);
            $ids[] = $case['id'];
            $coveredTags = array_merge($coveredTags, $case['tags']);
        }

        foreach ($corpus['zero_tolerance_tags'] as $tag) {
            $this->assertContains($tag, $coveredTags, sprintf('Zero-tolerance tag %s has no eval.', $tag));
        }
    }
}

<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Tests\TestCase;
use Illuminate\Http\JsonResponse;
use Everest\Services\AI\Tools\ToolResult;
use Everest\Services\AI\Tools\ToolExecutor;
use Everest\Services\AI\Tools\ToolDefinition;
use Everest\Services\AI\Tools\Definitions\ServerTools;

class ToolResultPayloadTest extends TestCase
{
    public function testFileReadReturnsLineMetadataAndAConcreteNextRange(): void
    {
        $definition = collect(ServerTools::all())->firstWhere('name', 'files_read');
        $contents = implode("\n", array_map(static fn (int $line): string => 'line ' . $line, range(1, 450)));

        $result = $definition->shape(ToolResult::ok($contents), ['file' => '/installer.log']);
        $data = $result->data;

        $this->assertTrue($result->truncated);
        $this->assertSame(450, $data['total_lines']);
        $this->assertSame(1, $data['start_line']);
        $this->assertSame(200, $data['end_line']);
        $this->assertSame([
            'file' => '/installer.log',
            'start_line' => 201,
            'end_line' => 400,
        ], $data['next']);
        $this->assertSame('Lines 1-200 of 450', $result->summary());
    }

    public function testFileReadCanSearchLiteralTextWithLineContext(): void
    {
        $definition = collect(ServerTools::all())->firstWhere('name', 'files_read');
        $contents = "starting\nloading libraries\nERROR failed to install\nCaused by missing artifact\nfinished";

        $result = $definition->shape(ToolResult::ok($contents), [
            'file' => '/installer.log',
            'query' => 'error',
            'context_lines' => 1,
        ]);
        $data = $result->data;

        $this->assertFalse($result->truncated);
        $this->assertSame(5, $data['total_lines']);
        $this->assertSame(1, $data['match_count']);
        $this->assertSame(3, $data['matches'][0]['line']);
        $this->assertSame('loading libraries', $data['matches'][0]['before'][0]['text']);
        $this->assertSame('Caused by missing artifact', $data['matches'][0]['after'][0]['text']);
        $this->assertSame('1 match in 5 lines', $result->summary());
    }

    public function testFileSearchKeepsItsMatchCountAndContinuationWithinTheResultBudget(): void
    {
        $definition = collect(ServerTools::all())->firstWhere('name', 'files_read');
        $contents = implode("\n", array_map(
            static fn (int $line): string => sprintf('ERROR line %d %s', $line, str_repeat('detail ', 100)),
            range(1, 50),
        ));

        $result = $definition->shape(ToolResult::ok($contents), [
            'file' => '/installer.log',
            'query' => 'error',
            'context_lines' => 0,
        ]);
        $data = $result->data;

        $this->assertTrue($result->truncated);
        $this->assertSame(50, $data['match_count']);
        $this->assertSame(count($data['matches']), $data['shown_matches']);
        $this->assertLessThan(50, $data['shown_matches']);
        $this->assertSame($data['matches'][array_key_last($data['matches'])]['line'] + 1, $data['next']['start_line']);
        $this->assertLessThanOrEqual(8192, strlen($result->toModelPayload()));
    }

    public function testLargeDecodedCollectionIsShapedBeforeItsFinalByteCap(): void
    {
        $rows = array_map(fn (int $id) => [
            'id' => $id,
            'name' => 'Product ' . $id,
            'description' => str_repeat('representative ', 20),
        ], range(1, 200));

        $method = new \ReflectionMethod(ToolExecutor::class, 'toResult');
        $raw = $method->invoke(app(ToolExecutor::class), new JsonResponse(['data' => $rows]));

        $this->assertIsArray($raw->data, 'The executor must not stringify oversized JSON before shaping.');

        $definition = new ToolDefinition(
            name: 'test_list',
            description: 'test',
            parameters: [],
            method: 'GET',
            uriTemplate: '/test',
            resultShaper: fn (array $value) => [
                'count' => count($value['data']),
                'items' => array_map(fn (array $row) => [
                    'id' => $row['id'],
                    'name' => $row['name'],
                ], $value['data']),
            ],
        );

        $result = $definition->shape($raw)->capped(1024);
        $payload = $result->toModelPayload();
        $decoded = json_decode($payload, true, flags: JSON_THROW_ON_ERROR);

        $this->assertLessThanOrEqual(1024, strlen($payload));
        $this->assertTrue($result->truncated);
        $this->assertSame(200, $decoded['result']['count']);
        $this->assertNotEmpty($decoded['result']['items']);
        $this->assertLessThan(200, count($decoded['result']['items']));
    }

    /*
    |--------------------------------------------------------------------------
    | AI-031 — a page is not the whole set
    |--------------------------------------------------------------------------
    */

    /**
     * Twenty-six users at a page size of twenty used to shape to `count: 20`
     * with nothing to say more existed, and the model answered "this panel has
     * twenty users" — confidently, and wrongly, from a result that had told it
     * so.
     */
    public function testAPaginatedListCarriesTheTotalAndSaysThereIsMore(): void
    {
        $shaped = $this->shape($this->page(rows: 20, total: 26, page: 1, perPage: 20, pages: 2));

        $this->assertSame(26, $shaped['pagination']['total']);
        $this->assertSame(1, $shaped['pagination']['page']);
        $this->assertSame(20, $shaped['pagination']['per_page']);
        $this->assertSame(2, $shaped['pagination']['total_pages']);
        $this->assertCount(20, $shaped['items']);
        $this->assertStringContainsString('page 1 of 2', $shaped['note']);
        $this->assertStringContainsString('26 records match', $shaped['note']);

        // And the collapsed tool row reports the set rather than the page.
        $this->assertSame('26 items (showing 20)', ToolResult::ok($shaped)->summary());
    }

    public function testASinglePageSaysNothingAboutPagination(): void
    {
        $shaped = $this->shape($this->page(rows: 4, total: 4, page: 1, perPage: 20, pages: 1));

        $this->assertSame(4, $shaped['pagination']['total']);
        $this->assertArrayNotHasKey('note', $shaped);
        $this->assertSame('4 items', ToolResult::ok($shaped)->summary());
    }

    /**
     * The shaper's own limit and the endpoint's page size are different cuts,
     * and a result that hit both has to say so twice.
     */
    public function testTheShaperLimitAndThePageLimitAreReportedSeparately(): void
    {
        $shaped = $this->shape($this->page(rows: 20, total: 100, page: 2, perPage: 20, pages: 5), limit: 5);

        $this->assertCount(5, $shaped['items']);
        $this->assertSame(20, $shaped['count']);
        $this->assertStringContainsString('first 5 of 20 entries on this page', $shaped['note']);
        $this->assertStringContainsString('page 2 of 5', $shaped['note']);
    }

    /**
     * Not every tool endpoint paginates — several return a plain collection —
     * and inventing a page count for those would be its own kind of lie.
     */
    public function testAnUnpaginatedCollectionIsUnchanged(): void
    {
        $shaped = $this->shape(['data' => [['attributes' => ['id' => 1]]]]);

        $this->assertArrayNotHasKey('pagination', $shaped);
        $this->assertSame(1, $shaped['count']);
    }

    /** A Fractal JSON-API page, in the shape the Application API really emits. */
    private function page(int $rows, int $total, int $page, int $perPage, int $pages): array
    {
        return [
            'data' => array_map(
                static fn (int $id) => ['type' => 'user', 'attributes' => ['id' => $id, 'username' => 'u' . $id]],
                range(1, $rows),
            ),
            'meta' => [
                'pagination' => [
                    'total' => $total,
                    'count' => $rows,
                    'per_page' => $perPage,
                    'current_page' => $page,
                    'total_pages' => $pages,
                    'links' => ['self' => 'https://panel.test/api/application/users?page=' . $page],
                ],
            ],
        ];
    }

    private function shape(array $data, int $limit = 25): array
    {
        $shaper = new class () {
            use \Everest\Services\AI\Tools\Definitions\DefinesToolSchemas;

            public function run(array $data, int $limit): array
            {
                return self::mapList($data, static fn (array $row) => ['id' => $row['id'] ?? null], $limit);
            }
        };

        return $shaper->run($data, $limit);
    }

    public function testEmojiTextRemainsValidUtf8AndWithinTheSerializedByteCap(): void
    {
        $result = ToolResult::ok(['message' => str_repeat('😀', 500)])->capped(700);
        $payload = $result->toModelPayload();

        $this->assertLessThanOrEqual(700, strlen($payload));
        $this->assertTrue(mb_check_encoding($payload, 'UTF-8'));
        $this->assertIsArray(json_decode($payload, true, flags: JSON_THROW_ON_ERROR));
    }
}

<?php

namespace Everest\Tests\Unit\Services\AI;

use Everest\Tests\TestCase;
use Illuminate\Http\JsonResponse;
use Everest\Services\AI\Tools\ToolResult;
use Everest\Services\AI\Tools\ToolExecutor;
use Everest\Services\AI\Tools\ToolDefinition;

class ToolResultPayloadTest extends TestCase
{
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

    public function testEmojiTextRemainsValidUtf8AndWithinTheSerializedByteCap(): void
    {
        $result = ToolResult::ok(['message' => str_repeat('😀', 500)])->capped(700);
        $payload = $result->toModelPayload();

        $this->assertLessThanOrEqual(700, strlen($payload));
        $this->assertTrue(mb_check_encoding($payload, 'UTF-8'));
        $this->assertIsArray(json_decode($payload, true, flags: JSON_THROW_ON_ERROR));
    }
}

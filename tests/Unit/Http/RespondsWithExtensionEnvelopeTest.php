<?php

namespace Everest\Tests\Unit\Http;

use Everest\Tests\TestCase;
use Everest\Traits\Controllers\RespondsWithExtensionEnvelope;

class RespondsWithExtensionEnvelopeTest extends TestCase
{
    private object $responder;

    public function setUp(): void
    {
        parent::setUp();

        $this->responder = new class () {
            use RespondsWithExtensionEnvelope {
                extensionListResponse as public;
                extensionItemResponse as public;
            }
        };
    }

    public function testListResponseShape(): void
    {
        $response = $this->responder->extensionListResponse(
            [3 => ['a' => 1], 7 => ['a' => 2]],
            ['hours' => 24]
        );

        $this->assertSame([
            'object' => 'list',
            'data' => [['a' => 1], ['a' => 2]],
            'meta' => ['hours' => 24],
        ], $response->getData(true));
    }

    public function testListResponseOmitsEmptyMeta(): void
    {
        $response = $this->responder->extensionListResponse([]);

        $this->assertSame(['object' => 'list', 'data' => []], $response->getData(true));
    }

    public function testItemResponseShape(): void
    {
        $response = $this->responder->extensionItemResponse('node_snapshot', ['healthy' => true], 201);

        $this->assertSame(201, $response->getStatusCode());
        $this->assertSame([
            'object' => 'node_snapshot',
            'attributes' => ['healthy' => true],
        ], $response->getData(true));
    }
}

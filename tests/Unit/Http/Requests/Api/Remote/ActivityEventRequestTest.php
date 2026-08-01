<?php

namespace Everest\Tests\Unit\Http\Requests\Api\Remote;

use Everest\Tests\TestCase;
use Illuminate\Support\Facades\Validator;
use Everest\Http\Requests\Api\Remote\ActivityEventRequest;

class ActivityEventRequestTest extends TestCase
{
    public function testEventBatchCountIsBounded(): void
    {
        $request = new ActivityEventRequest();
        $validator = Validator::make([
            'data' => array_fill(0, ActivityEventRequest::MAX_EVENTS + 1, $this->event()),
        ], $request->rules());
        $request->replace($validator->getData());
        $request->withValidator($validator);

        $this->assertTrue($validator->fails());
        $this->assertArrayHasKey('data', $validator->errors()->toArray());
    }

    public function testIndividualMetadataBytesAreBounded(): void
    {
        $request = new ActivityEventRequest();
        $event = $this->event([
            'value' => str_repeat('x', ActivityEventRequest::MAX_METADATA_BYTES),
        ]);
        $validator = Validator::make(['data' => [$event]], $request->rules());
        $request->replace($validator->getData());
        $request->withValidator($validator);

        $this->assertTrue($validator->fails());
        $this->assertArrayHasKey('data.0.metadata', $validator->errors()->toArray());
    }

    public function testNestedMetadataStructureIsBounded(): void
    {
        $request = new ActivityEventRequest();
        $metadata = ['value' => 'leaf'];
        for ($i = 0; $i < ActivityEventRequest::MAX_METADATA_DEPTH; ++$i) {
            $metadata = ['nested' => $metadata];
        }

        $validator = Validator::make(['data' => [$this->event($metadata)]], $request->rules());
        $request->replace($validator->getData());
        $request->withValidator($validator);

        $this->assertTrue($validator->fails());
        $this->assertArrayHasKey('data.0.metadata', $validator->errors()->toArray());
    }

    public function testNormalActivityBatchPassesLimits(): void
    {
        $request = new ActivityEventRequest();
        $validator = Validator::make([
            'data' => [$this->event(['files' => ['/server.properties'], 'source' => 'sftp'])],
        ], $request->rules());
        $request->replace($validator->getData());
        $request->withValidator($validator);

        $this->assertTrue($validator->passes());
    }

    private function event(array $metadata = []): array
    {
        return [
            'user' => '1bb1a444-4cc0-4d2d-9c5f-6a267bafb5bb',
            'server' => '433c0328-bcfe-4ece-8b8a-5e91919380c9',
            'event' => 'server:sftp.write',
            'metadata' => $metadata,
            'ip' => '192.0.2.10',
            'timestamp' => '2026-07-28T00:00:00Z',
        ];
    }
}

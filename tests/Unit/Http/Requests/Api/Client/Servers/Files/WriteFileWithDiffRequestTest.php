<?php

namespace Everest\Tests\Unit\Http\Requests\Api\Client\Servers\Files;

use Everest\Tests\TestCase;
use Illuminate\Http\Request;
use Everest\Models\Permission;
use Illuminate\Support\Facades\Validator;
use Illuminate\Validation\ValidationException;
use Illuminate\Auth\Access\AuthorizationException;
use Everest\Http\Requests\Api\Client\Servers\Files\WriteFileWithDiffRequest;

class WriteFileWithDiffRequestTest extends TestCase
{
    public function testExistingCreatePermissionBehaviorRemainsUnchanged(): void
    {
        $this->assertSame(
            Permission::ACTION_FILE_CREATE,
            (new WriteFileWithDiffRequest())->permission()
        );
    }

    public function testDecodedContentFieldsHaveStrictByteCaps(): void
    {
        $request = new WriteFileWithDiffRequest();
        $oversized = str_repeat('x', WriteFileWithDiffRequest::MAX_CONTENT_BYTES + 1);

        $validator = Validator::make([
            'file' => '/server.properties',
            'content' => $oversized,
            'original_content' => '',
        ], $request->rules());
        $request->withValidator($validator);

        $this->assertTrue($validator->fails());
        $this->assertArrayHasKey('content', $validator->errors()->toArray());
    }

    public function testBothContentFieldsHaveStrictLineCaps(): void
    {
        $request = new WriteFileWithDiffRequest();
        $tooManyLines = str_repeat("\n", WriteFileWithDiffRequest::MAX_CONTENT_LINES);

        $validator = Validator::make([
            'file' => '/server.properties',
            'content' => $tooManyLines,
            'original_content' => $tooManyLines,
        ], $request->rules());
        $request->withValidator($validator);

        $this->assertTrue($validator->fails());
        $this->assertArrayHasKey('content', $validator->errors()->toArray());
        $this->assertArrayHasKey('original_content', $validator->errors()->toArray());
    }

    public function testBoundarySizedContentPassesFieldValidation(): void
    {
        $request = new WriteFileWithDiffRequest();
        $content = str_repeat('x', WriteFileWithDiffRequest::MAX_CONTENT_BYTES);

        $validator = Validator::make([
            'file' => '/server.properties',
            'content' => $content,
            'original_content' => '',
        ], $request->rules());
        $request->withValidator($validator);

        $this->assertTrue($validator->passes());
    }

    public function testOriginalContentIsMandatoryForCompareAndSwap(): void
    {
        $request = new WriteFileWithDiffRequest();

        $validator = Validator::make([
            'file' => '/server.properties',
            'content' => 'after',
        ], $request->rules());

        $this->assertTrue($validator->fails());
        $this->assertArrayHasKey('original_content', $validator->errors()->toArray());
    }

    public function testRawJsonBodyHasASeparateHardCap(): void
    {
        $request = TestableWriteFileWithDiffRequest::createFromBase(
            Request::create(
                '/write-with-diff',
                'POST',
                [],
                [],
                [],
                ['CONTENT_TYPE' => 'application/json'],
                str_repeat('x', WriteFileWithDiffRequest::MAX_REQUEST_BYTES + 1)
            )
        );
        $request->setContainer($this->app);

        $this->expectException(ValidationException::class);
        $request->runPrepareForValidation();
    }

    public function testAuthorizationRunsBeforeOversizedBodyInspection(): void
    {
        $request = UnauthorizedWriteFileWithDiffRequest::createFromBase(
            Request::create(
                '/write-with-diff',
                'POST',
                [],
                [],
                [],
                ['CONTENT_TYPE' => 'application/json'],
                str_repeat('x', WriteFileWithDiffRequest::MAX_REQUEST_BYTES + 1)
            )
        );
        $request->setContainer($this->app);

        $this->expectException(AuthorizationException::class);
        $request->runPrepareForValidation();
    }
}

class TestableWriteFileWithDiffRequest extends WriteFileWithDiffRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function runPrepareForValidation(): void
    {
        parent::prepareForValidation();
    }
}

class UnauthorizedWriteFileWithDiffRequest extends TestableWriteFileWithDiffRequest
{
    public function authorize(): bool
    {
        return false;
    }
}

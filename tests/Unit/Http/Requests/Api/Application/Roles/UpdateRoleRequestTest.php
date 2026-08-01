<?php

namespace Everest\Tests\Unit\Http\Requests\Api\Application\Roles;

use Everest\Tests\TestCase;
use Illuminate\Support\Facades\Validator;
use Everest\Http\Requests\Api\Application\Roles\UpdateRoleRequest;

class UpdateRoleRequestTest extends TestCase
{
    public function testUpdateRejectsUnknownPermissionIdentifiers(): void
    {
        $request = new UpdateRoleRequest();
        $request->setRouteResolver(static fn () => new class () {
            public function parameter(string $key): int
            {
                return 42;
            }
        });
        $rules = $request->rules();
        $validator = Validator::make([
            'name' => 'Custom',
            'permissions' => ['removed.permission'],
        ], $rules);

        $this->assertArrayHasKey('permissions.*', $rules);
        $this->assertTrue($validator->errors()->has('permissions.0'));
    }

    public function testPermissionOnlyPatchDoesNotRequireProfileMetadata(): void
    {
        $request = new UpdateRoleRequest();
        $request->setRouteResolver(static fn () => new class () {
            public function parameter(string $key): int
            {
                return 42;
            }
        });
        $validator = Validator::make([
            'permissions' => ['users.read'],
        ], $request->rules());

        $this->assertFalse($validator->fails());
    }
}

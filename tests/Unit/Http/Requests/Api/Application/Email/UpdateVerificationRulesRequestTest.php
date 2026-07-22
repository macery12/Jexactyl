<?php

namespace Everest\Tests\Unit\Http\Requests\Api\Application\Email;

use Everest\Tests\TestCase;
use Everest\Http\Requests\Api\Application\Email\UpdateVerificationRulesRequest;

class UpdateVerificationRulesRequestTest extends TestCase
{
    public function testNormalizedRulesIncludeTickets(): void
    {
        /** @var UpdateVerificationRulesRequest $request */
        $request = UpdateVerificationRulesRequest::create('/', 'PUT', [
            'billing' => ['can_view' => true, 'can_interact' => false],
            'orders' => ['can_view' => true, 'can_interact' => false],
            'donate' => ['can_view' => false, 'can_interact' => false],
            'credentials' => ['can_view' => true, 'can_interact' => true],
            'tickets' => ['can_view' => true, 'can_interact' => false],
        ]);

        $this->assertSame([
            'billing' => ['can_view' => true, 'can_interact' => false],
            'orders' => ['can_view' => true, 'can_interact' => false],
            'credentials' => ['can_view' => true, 'can_interact' => true],
            'tickets' => ['can_view' => true, 'can_interact' => false],
        ], $request->normalizedRules());
    }
}

<?php

namespace Everest\Tests\Unit\Http\Requests\Api\Application\Billing;

use Everest\Tests\TestCase;
use Everest\Models\AdminRole;
use Illuminate\Support\Facades\Validator;
use Everest\Http\Requests\Api\Application\Billing\NodePricing\GetNodePricingRequest;
use Everest\Http\Requests\Api\Application\Billing\NodePricing\ResetNodePricingRequest;
use Everest\Http\Requests\Api\Application\Billing\NodePricing\UpdateNodePricingRequest;
use Everest\Http\Requests\Api\Application\Billing\BillingCycles\GetBillingCyclesRequest;
use Everest\Http\Requests\Api\Application\Billing\BillingCycles\SyncBillingCyclesRequest;
use Everest\Http\Requests\Api\Application\Billing\NodePricing\ResetAllNodePricingRequest;
use Everest\Http\Requests\Api\Application\Billing\BillingCycles\DeleteBillingCycleRequest;
use Everest\Http\Requests\Api\Application\Billing\NodePricing\BatchUpdateNodePricingRequest;

class BillingPermissionsRequestTest extends TestCase
{
    public function testBillingReadRequestsUseBillingReadPermission(): void
    {
        $this->assertSame(AdminRole::BILLING_READ, (new GetNodePricingRequest())->permission());
        $this->assertSame(AdminRole::BILLING_READ, (new GetBillingCyclesRequest())->permission());
    }

    public function testBillingWriteRequestsUseBillingUpdatePermission(): void
    {
        $requests = [
            new UpdateNodePricingRequest(),
            new BatchUpdateNodePricingRequest(),
            new ResetNodePricingRequest(),
            new ResetAllNodePricingRequest(),
            new SyncBillingCyclesRequest(),
            new DeleteBillingCycleRequest(),
        ];

        foreach ($requests as $request) {
            $this->assertSame(AdminRole::BILLING_UPDATE, $request->permission());
        }
    }

    public function testNodePricingUpdateRequestValidatesExpectedPayload(): void
    {
        $request = new UpdateNodePricingRequest();

        $this->assertFalse(Validator::make([
            'price_multiplier' => 7,
            'price_multiplier_description' => str_repeat('a', 501),
        ], $request->rules())->passes());

        $this->assertTrue(Validator::make([
            'price_multiplier' => 1.25,
            'price_multiplier_description' => 'Fast node',
        ], $request->rules())->passes());
    }

    public function testNodePricingBatchRequestRequiresStructuredNodeUpdates(): void
    {
        $request = new BatchUpdateNodePricingRequest();

        $this->assertFalse(Validator::make([
            'nodes' => [
                ['id' => 1],
            ],
        ], $request->rules())->passes());

        $this->assertTrue(Validator::make([
            'nodes' => [
                ['id' => 1, 'price_multiplier' => 1.1, 'price_multiplier_description' => 'Premium'],
                ['id' => 2, 'price_multiplier' => 0.9],
            ],
        ], $request->rules())->passes());
    }

    public function testBillingCycleSyncRequestValidatesCyclePayload(): void
    {
        $request = new SyncBillingCyclesRequest();

        $this->assertFalse(Validator::make([
            'cycles' => [
                ['days' => 0],
            ],
        ], $request->rules())->passes());

        $this->assertTrue(Validator::make([
            'cycles' => [
                ['days' => 30, 'is_enabled' => true],
                ['days' => 60, 'is_enabled' => false],
            ],
        ], $request->rules())->passes());
    }
}

<?php

namespace Everest\Tests\Unit\Http\Requests\Api\Client\Billing;

use Everest\Tests\TestCase;
use Illuminate\Support\Facades\Validator;
use Everest\Http\Requests\Api\Client\Billing\UpdateCheckoutRequest;

class UpdateCheckoutRequestTest extends TestCase
{
    public function testStripeCreationRequiresCheckoutNonce(): void
    {
        $request = UpdateCheckoutRequest::create(
            '/api/client/billing/products/1/intent',
            'POST',
        );

        $validator = Validator::make($request->all(), $request->rules());

        $this->assertTrue($validator->errors()->has('checkout_nonce'));
    }

    public function testPayPalCreationRequiresCheckoutNonce(): void
    {
        $request = UpdateCheckoutRequest::create(
            '/api/client/billing/products/1/paypal/order',
            'POST',
        );

        $validator = Validator::make($request->all(), $request->rules());

        $this->assertTrue($validator->errors()->has('checkout_nonce'));
    }

    public function testValidNoncePassesProviderCreationValidation(): void
    {
        $request = UpdateCheckoutRequest::create(
            '/api/client/billing/products/1/intent',
            'POST',
            ['checkout_nonce' => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],
        );

        $validator = Validator::make($request->all(), $request->rules());

        $this->assertFalse($validator->errors()->has('checkout_nonce'));
    }

    public function testLaterPaymentOperationsDoNotRequireNonce(): void
    {
        $request = UpdateCheckoutRequest::create(
            '/api/client/billing/process',
            'POST',
            ['intent' => 'pi_existing'],
        );

        $validator = Validator::make($request->all(), $request->rules());

        $this->assertFalse($validator->errors()->has('checkout_nonce'));
    }

    public function testPlanChangeCheckoutRequiresServer(): void
    {
        $request = UpdateCheckoutRequest::create(
            '/api/client/billing/products/2/intent',
            'POST',
            [
                'checkout_nonce' => 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
                'plan_change' => true,
            ],
        );

        $validator = Validator::make($request->all(), $request->rules());

        $this->assertTrue($validator->errors()->has('server_id'));
    }

    public function testPlanChangeCheckoutRejectsCycleCouponAndProvisioningFields(): void
    {
        $request = UpdateCheckoutRequest::create(
            '/api/client/billing/products/2/intent',
            'POST',
            [
                'checkout_nonce' => 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                'plan_change' => true,
                'billing_days' => 90,
                'coupon_id' => 4,
                'node_id' => 3,
                'name' => 'Injected name',
                'renewal' => true,
            ],
        );

        $validator = Validator::make($request->all(), $request->rules());

        foreach (['billing_days', 'coupon_id', 'node_id', 'name', 'renewal'] as $field) {
            $this->assertTrue($validator->errors()->has($field), "{$field} should be prohibited.");
        }
    }
}

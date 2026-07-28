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
}

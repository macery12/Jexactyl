<?php

namespace Everest\Http\Requests\Api\Client\Billing;

use Illuminate\Validation\Rule;
use Everest\Services\Billing\BillingDefaults;
use Everest\Http\Requests\Api\Client\ClientApiRequest;

class UpdateCheckoutRequest extends ClientApiRequest
{
    public function rules(): array
    {
        $createsProviderOrder = $this->isMethod('POST')
            && (
                $this->is('api/client/billing/products/*/intent')
                || $this->is('api/client/billing/products/*/paypal/order')
            );
        $isPlanChange = $this->boolean('plan_change', false);

        return [
            'intent'         => ['nullable', 'string', 'max:255'],
            'order_id'       => ['nullable', 'string', 'max:255'],
            'checkout_nonce' => [$createsProviderOrder ? 'required' : 'nullable', 'uuid'],
            'name'           => [Rule::prohibitedIf($isPlanChange), 'nullable', 'string', 'min:3', 'max:191'],
            'node_id'        => [Rule::prohibitedIf($isPlanChange), 'nullable', 'integer', 'exists:nodes,id'],
            'egg_id'         => [Rule::prohibitedIf($isPlanChange), 'nullable', 'integer', 'exists:eggs,id'],
            'billing_days'   => [Rule::prohibitedIf($isPlanChange), 'nullable', 'integer', 'min:1', 'max:365'],
            'coupon_id'      => [Rule::prohibitedIf($isPlanChange), 'nullable', 'integer', 'exists:coupons,id'],
            'renewal'        => [Rule::prohibitedIf($isPlanChange), 'nullable', 'boolean'],
            'plan_change'    => ['nullable', 'boolean'],
            'server_id'      => [Rule::requiredIf($isPlanChange), 'nullable', 'integer', 'exists:servers,id'],
            'variables'      => [Rule::prohibitedIf($isPlanChange), 'nullable', 'array'],
            'domain_payload' => [Rule::prohibitedIf($isPlanChange), 'nullable', 'array'],
            'return_url'     => ['nullable', 'url', 'max:2048'],
            'cancel_url'     => ['nullable', 'url', 'max:2048'],
        ];
    }

    public function isRenewal(): bool
    {
        return $this->boolean('renewal', false);
    }

    public function isPlanChange(): bool
    {
        return $this->boolean('plan_change', false);
    }

    public function serverName(): string
    {
        return trim($this->string('name', ''));
    }

    public function nodeId(): int
    {
        return (int) $this->input('node_id', 0);
    }

    public function billingDays(): int
    {
        return (int) $this->input('billing_days', BillingDefaults::defaultBillingDays());
    }

    public function couponId(): ?int
    {
        return $this->input('coupon_id') ? (int) $this->input('coupon_id') : null;
    }

    public function eggId(): ?int
    {
        return $this->input('egg_id') ? (int) $this->input('egg_id') : null;
    }

    public function serverId(): ?int
    {
        return $this->input('server_id') ? (int) $this->input('server_id') : null;
    }
}

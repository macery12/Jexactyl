<?php

namespace Everest\Http\Requests\Api\Client\Billing;

use Everest\Services\Billing\BillingDefaults;
use Everest\Http\Requests\Api\Client\ClientApiRequest;

class UpdateCheckoutRequest extends ClientApiRequest
{
    public function rules(): array
    {
        return [
            'name'           => ['nullable', 'string', 'min:3', 'max:191'],
            'node_id'        => ['nullable', 'integer', 'exists:nodes,id'],
            'egg_id'         => ['nullable', 'integer', 'exists:eggs,id'],
            'billing_days'   => ['nullable', 'integer', 'min:1'],
            'coupon_id'      => ['nullable', 'integer', 'exists:coupons,id'],
            'renewal'        => ['nullable', 'boolean'],
            'server_id'      => ['nullable', 'integer', 'exists:servers,id'],
            'variables'      => ['nullable', 'array'],
            'domain_payload' => ['nullable', 'array'],
        ];
    }

    public function isRenewal(): bool
    {
        return $this->boolean('renewal', false);
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

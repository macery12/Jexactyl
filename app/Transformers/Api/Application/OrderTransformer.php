<?php

namespace Everest\Transformers\Api\Application;

use Everest\Models\Billing\Order;
use Everest\Transformers\Api\Transformer;

class OrderTransformer extends Transformer
{
    /**
     * {@inheritdoc}
     */
    public function getResourceName(): string
    {
        return Order::RESOURCE_NAME;
    }

    /**
     * Transform this model into a representation that can be consumed by a client.
     */
    public function transform(Order $model): array
    {
        $server = $model->server;
        $product = $model->product;
        $user = $model->user;
        $paymentProcessor = $this->resolvePaymentProcessor($model);

        return [
            'id' => $model->id,
            'name' => $model->name,
            'user_id' => $model->user_id,
            'username' => $user ? $user->username : null,
            'user_email' => $user ? $user->email : null,
            'description' => $model->description,
            'total' => $model->total,
            'status' => $model->status,
            'product_id' => $model->product_id,
            'product_name' => $model->product_name ?? ($product ? $product->name : null),
            'type' => $model->type ?? '?',
            'payment_processor' => $paymentProcessor,
            'transaction' => $model->transaction ? [
                'external_id' => $model->transaction->external_id,
                'capture_id'  => $model->transaction->capture_id,
                'status'      => $model->transaction->status,
                'amount'      => $model->transaction->amount,
                'currency'    => $model->transaction->currency,
                'payer_id'    => $model->transaction->payer_id,
                'payer_email' => $model->transaction->payer_email,
                'captured_at' => $model->transaction->captured_at?->toIso8601String(),
            ] : null,
            'threat_index' => $model->threat_index,
            'subtotal' => $model->subtotal,
            'discount' => $model->discount,
            'billing_days' => $model->billing_days,
            'egg_id' => $model->egg_id,
            'coupon_id' => $model->coupon_id,
            'node_id' => $model->node_id,
            'final_price' => $model->final_price,
            'server_id' => $model->server_id,
            'server_uuid' => $server ? $server->uuid : null,
            'server_name' => $server ? $server->name : null,
            'created_at' => $model->created_at->toIso8601String(),
            'updated_at' => $model->updated_at->toIso8601String(),
        ];
    }

    private function resolvePaymentProcessor(Order $model): string
    {
        return strtolower((string) ($model->payment_processor ?? 'stripe'));
    }
}

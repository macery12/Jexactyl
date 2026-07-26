<?php

namespace Everest\Models\Billing;

use Everest\Models\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property int $id
 * @property int $order_id
 * @property string $processor
 * @property string|null $external_id
 * @property string|null $provider_customer_id
 * @property string|null $capture_id
 * @property string|null $status
 * @property string|null $provider_negative_status
 * @property \Carbon\Carbon|null $provider_negative_at
 * @property array|null $provider_negative_events
 * @property float|string|null $amount
 * @property string|null $currency
 * @property string|null $payer_id
 * @property string|null $payer_email
 * @property string|null $payment_token
 * @property array|null $raw_metadata
 * @property \Carbon\Carbon|null $captured_at
 * @property \Carbon\Carbon $created_at
 * @property \Carbon\Carbon $updated_at
 * @property Order|null $order
 */
class PaymentTransaction extends Model
{
    protected $table = 'payment_transactions';

    public static array $validationRules = [
        'order_id'      => 'required|integer|exists:orders,id',
        'processor'     => 'required|string|in:stripe,paypal,free',
        'external_id'   => 'nullable|string|max:255',
        'provider_customer_id' => 'nullable|string|max:255',
        'capture_id'    => 'nullable|string|max:255',
        'status'        => 'nullable|string|max:50',
        'provider_negative_status' => 'nullable|string|max:50',
        'provider_negative_at' => 'nullable|date',
        'provider_negative_events' => 'nullable|array',
        'amount'        => 'nullable|numeric|min:0',
        'currency'      => 'nullable|string|max:10',
        'payer_id'      => 'nullable|string|max:255',
        'payer_email'   => 'nullable|email|max:255',
        'payment_token' => 'nullable|string|max:255',
        'raw_metadata'  => 'nullable|array',
        'captured_at'   => 'nullable|date',
    ];

    protected $fillable = [
        'order_id',
        'processor',
        'external_id',
        'provider_customer_id',
        'capture_id',
        'status',
        'provider_negative_status',
        'provider_negative_at',
        'provider_negative_events',
        'amount',
        'currency',
        'payer_id',
        'payer_email',
        'payment_token',
        'raw_metadata',
        'captured_at',
    ];

    protected $casts = [
        'captured_at'  => 'datetime',
        'provider_negative_at' => 'datetime',
        'provider_negative_events' => 'array',
        'raw_metadata' => 'array',
        'amount'       => 'decimal:2',
    ];

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }
}

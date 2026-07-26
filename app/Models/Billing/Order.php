<?php

namespace Everest\Models\Billing;

use Everest\Models\User;
use Everest\Models\Model;
use Illuminate\Http\Request;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property int $id
 * @property string $name
 * @property int $user_id
 * @property string $description
 * @property float $total
 * @property string $status
 * @property int $product_id
 * @property bool $requires_free_product_entitlement
 * @property string|null $product_name
 * @property int|null $billing_days
 * @property float|null $final_price
 * @property float|null $multiplier_used
 * @property int|null $egg_id
 * @property int|null $coupon_id
 * @property float|null $subtotal
 * @property float|null $discount
 * @property int|null $node_id
 * @property int|null $server_id
 * @property array|null $variables
 * @property array|null $domain_payload
 * @property string $type
 * @property int $threat_index
 * @property string|null $payment_intent_id
 * @property string $payment_processor
 * @property string|null $paypal_order_id
 * @property string|null $paypal_capture_id
 * @property string|null $paypal_payer_id
 * @property string|null $paypal_payer_email
 * @property string|null $paypal_status
 * @property float|null $paypal_amount
 * @property string|null $paypal_currency
 * @property \Carbon\Carbon|null $paypal_captured_at
 * @property string|null $checkout_nonce
 * @property string|null $checkout_request_fingerprint
 * @property string|null $checkout_fingerprint
 * @property string|null $checkout_currency
 * @property int|null $checkout_amount_minor
 * @property \Carbon\Carbon|null $checkout_locked_at
 * @property \Carbon\Carbon|null $fulfillment_started_at
 * @property string|null $fulfillment_claim
 * @property \Carbon\Carbon $created_at
 * @property \Carbon\Carbon $updated_at
 * @property \Everest\Models\Server|null $server
 * @property Product|null $product
 * @property User|null $user
 * @property Coupon|null $coupon
 * @property PaymentTransaction|null $transaction
 */
class Order extends Model
{
    public const STATUS_FAILED = 'failed';
    public const STATUS_CANCELLED = 'cancelled';
    public const STATUS_EXPIRED = 'expired';
    public const STATUS_PENDING = 'pending';
    public const STATUS_FULFILLING = 'fulfilling';
    public const STATUS_PAYMENT_REVIEW = 'payment_review';
    public const STATUS_PROCESSED = 'processed';

    public const TYPE_NEW = 'new';
    public const TYPE_UPG = 'upg';
    public const TYPE_REN = 'ren';

    /**
     * The resource name for this model when it is transformed into an
     * API representation using fractal.
     */
    public const RESOURCE_NAME = 'order';

    /**
     * The table associated with the model.
     */
    protected $table = 'orders';

    /**
     * Fields that are mass assignable.
     */
    protected $fillable = [
        'name', 'user_id', 'description', 'payment_intent_id', 'payment_processor', 'paypal_order_id',
        'paypal_capture_id', 'paypal_payer_id', 'paypal_payer_email', 'paypal_status', 'paypal_amount', 'paypal_currency', 'paypal_captured_at',
        'payment_token', 'total', 'status', 'product_id', 'product_name', 'billing_days', 'final_price', 'multiplier_used', 'node_multiplier_used', 'egg_id', 'node_id', 'server_id', 'variables', 'type', 'threat_index',
        'checkout_nonce', 'checkout_request_fingerprint', 'checkout_fingerprint', 'checkout_currency', 'checkout_amount_minor', 'checkout_locked_at', 'fulfillment_started_at', 'fulfillment_claim',
        'domain_payload',
        'coupon_id', 'subtotal', 'discount',
        'requires_free_product_entitlement',
    ];

    /**
     * Cast values to correct type.
     */
    protected $casts = [
        'user_id' => 'int',
        'total' => 'float',
        'product_id' => 'int',
        'requires_free_product_entitlement' => 'boolean',
        'billing_days' => 'int',
        'final_price' => 'float',
        'multiplier_used' => 'float',
        'node_multiplier_used' => 'float',
        'egg_id' => 'int',
        'node_id' => 'int',
        'server_id' => 'int',
        'variables' => 'array',
        'domain_payload' => 'array',
        'threat_index' => 'int',
        'coupon_id' => 'int',
        'subtotal' => 'float',
        'discount' => 'float',
        'paypal_amount' => 'float',
        'paypal_captured_at' => 'datetime',
        'checkout_locked_at' => 'datetime',
        'fulfillment_started_at' => 'datetime',
        'checkout_amount_minor' => 'integer',
    ];

    public static array $validationRules = [
        'name' => 'string|required|min:3',
        'user_id' => 'required|exists:users,id',
        'description' => 'required|string|min:3',
        'total' => 'required|min:0',
        'status' => 'required|in:expired,pending,fulfilling,payment_review,failed,cancelled,processed',
        'product_id' => 'exists:products,id',
        'egg_id' => 'nullable|exists:eggs,id',
        'domain_payload' => 'nullable|array',
        'type' => 'required|in:new,upg,ren',
        'threat_index' => 'nullable|int|min:-1|max:100',
        'payment_intent_id' => 'nullable|string',
        'coupon_id' => 'nullable|exists:coupons,id',
        'subtotal' => 'nullable|numeric|min:0',
        'discount' => 'nullable|numeric|min:0',
    ];

    /**
     * Resolve the order type from an HTTP request.
     *
     * Consolidates the `getOrderType()` logic that was previously duplicated
     * across CheckoutController and PayPalCheckoutController.
     */
    public static function resolveTypeFromRequest(Request $request): string
    {
        return ($request->has('renewal') && $request->boolean('renewal'))
            ? self::TYPE_REN
            : self::TYPE_NEW;
    }

    /**
     * Get the coupon associated with this order.
     *
     * @return BelongsTo<Coupon, $this>
     */
    public function coupon(): BelongsTo
    {
        return $this->belongsTo(Coupon::class);
    }

    /**
     * Get the server associated with this order.
     *
     * @return BelongsTo<\Everest\Models\Server, $this>
     */
    public function server(): BelongsTo
    {
        return $this->belongsTo(\Everest\Models\Server::class);
    }

    /**
     * Get the payment transaction associated with this order.
     *
     * @return HasOne<PaymentTransaction, $this>
     */
    public function transaction(): HasOne
    {
        return $this->hasOne(PaymentTransaction::class);
    }

    /**
     * Get the product associated with this order.
     *
     * @return BelongsTo<Product, $this>
     */
    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    /**
     * Get the user associated with this order.
     *
     * @return BelongsTo<User, $this>
     */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}

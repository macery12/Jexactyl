<?php

namespace Everest\Models\Billing;

use Everest\Models\Model;

class FreeProductEntitlement extends Model
{
    protected $table = 'free_product_entitlements';

    protected $fillable = [
        'user_id',
        'product_id',
        'order_id',
        'server_id',
        'status',
        'expires_at',
    ];

    protected $casts = [
        'user_id' => 'integer',
        'product_id' => 'integer',
        'order_id' => 'integer',
        'server_id' => 'integer',
        'expires_at' => 'datetime',
    ];
}

<?php

namespace Everest\Models\Billing;

use Everest\Models\User;
use Everest\Models\Model;
use Everest\Casts\EncryptedJson;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Stores encrypted PII for a user's billing profile.
 *
 * All personal data (name, address, phone) is stored in a single
 * AES-256-CBC encrypted JSON blob via the EncryptedJson cast.
 *
 * @property int $id
 * @property int $user_id
 * @property array|null $encrypted_data Keys: first_name, last_name, address_line1, address_line2, city, state, postal_code, country, phone
 * @property \Illuminate\Support\Carbon|null $created_at
 * @property \Illuminate\Support\Carbon|null $updated_at
 */
class UserBillingProfile extends Model
{
    protected $table = 'user_billing_profiles';

    protected $fillable = [
        'user_id',
        'encrypted_data',
    ];

    protected $casts = [
        'encrypted_data' => EncryptedJson::class,
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}

<?php

namespace Everest\Models\Billing;

use Everest\Models\User;
use Everest\Models\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property int $id
 * @property string $uuid
 * @property int $order_id
 * @property int $user_id
 * @property string $invoice_number
 * @property string $status active|expired|void
 * @property string|null $data_path Path to the encrypted JSON snapshot on $data_disk
 * @property string|null $data_disk Storage driver: local|s3|r2
 * @property int|null $data_size_bytes Size of the encrypted snapshot file in bytes
 * @property string|null $pdf_cached_path Local-disk path to a temporarily cached PDF
 * @property \Carbon\Carbon|null $pdf_cached_at When the current PDF cache was generated
 * @property \Carbon\Carbon|null $pdf_expires_at When the cached PDF expires (24 h TTL)
 * @property float $total
 * @property string $currency
 * @property \Carbon\Carbon|null $generated_at
 * @property \Carbon\Carbon|null $expires_at null = keep forever; set = auto-cleanup date
 * @property \Carbon\Carbon|null $voided_at
 * @property int|null $voided_by
 * @property string|null $voided_reason
 * @property \Carbon\Carbon $created_at
 * @property \Carbon\Carbon $updated_at
 * @property Order|null $order
 * @property User|null $user
 */
class Invoice extends Model
{
    public const STATUS_ACTIVE = 'active';
    public const STATUS_EXPIRED = 'expired';
    public const STATUS_VOID = 'void';

    public const RESOURCE_NAME = 'invoice';

    protected $table = 'invoices';

    protected $fillable = [
        'uuid',
        'order_id',
        'user_id',
        'invoice_number',
        'status',
        'data_path',
        'data_disk',
        'data_size_bytes',
        'pdf_cached_path',
        'pdf_cached_at',
        'pdf_expires_at',
        'total',
        'currency',
        'generated_at',
        'expires_at',
        'voided_at',
        'voided_by',
        'voided_reason',
    ];

    protected $casts = [
        'order_id' => 'int',
        'user_id' => 'int',
        'data_size_bytes' => 'int',
        'total' => 'float',
        'generated_at' => 'datetime',
        'expires_at' => 'datetime',
        'pdf_cached_at' => 'datetime',
        'pdf_expires_at' => 'datetime',
        'voided_at' => 'datetime',
        'voided_by' => 'int',
    ];

    public function order(): BelongsTo
    {
        return $this->belongsTo(Order::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /**
     * Whether the data snapshot exists and the invoice is not voided/expired.
     * A downloadable invoice will always produce a PDF on demand (even if the
     * local cache has expired — it regenerates automatically).
     */
    public function isDownloadable(): bool
    {
        return $this->status === self::STATUS_ACTIVE
            && $this->data_path !== null
            && $this->data_disk !== null;
    }

    /**
     * Whether a valid local PDF cache exists for this invoice.
     */
    public function hasCachedPdf(): bool
    {
        return $this->pdf_cached_path !== null
            && $this->pdf_expires_at !== null
            && $this->pdf_expires_at->isFuture();
    }
}

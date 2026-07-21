<?php

namespace Everest\Models;

use Illuminate\Database\Eloquent\Model;

/**
 * @property int $id
 * @property string $provider
 * @property string $type
 * @property string $project_id
 * @property int $file_size_bytes
 * @property string $status
 * @property int|null $server_id
 * @property int|null $user_id
 * @property \Carbon\Carbon $created_at
 * @property \Carbon\Carbon $updated_at
 */
class MarketplaceInstallLog extends Model
{
    protected $table = 'marketplace_install_logs';

    protected $fillable = [
        'provider',
        'type',
        'project_id',
        'file_size_bytes',
        'status',
        'server_id',
        'user_id',
    ];

    protected $casts = [
        'file_size_bytes' => 'integer',
    ];

    public const STATUS_SUCCESS = 'success';
    public const STATUS_FAILED = 'failed';
}

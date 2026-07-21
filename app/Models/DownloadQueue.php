<?php

namespace Everest\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property int $id
 * @property string $uuid
 * @property int $server_id
 * @property int|null $user_id
 * @property int|null $parent_id
 * @property string $provider
 * @property string $source
 * @property string $project_id
 * @property string $file_id
 * @property string|null $download_url
 * @property string|null $install_path
 * @property string|null $file_hash_sha512
 * @property string $hash_algo
 * @property int|null $total_children
 * @property int $completed_children
 * @property int $failed_children
 * @property string|null $file_name
 * @property string|null $error_message
 * @property string|null $install_log
 * @property string|null $phase
 * @property string $status
 * @property \Carbon\Carbon|null $started_at
 * @property \Carbon\Carbon|null $completed_at
 * @property \Carbon\Carbon $created_at
 * @property \Carbon\Carbon $updated_at
 */
class DownloadQueue extends Model
{
    protected $table = 'download_queue';

    protected $fillable = [
        'uuid',
        'server_id',
        'user_id',
        'provider',
        'source',
        'project_id',
        'file_id',
        'parent_id',
        'download_url',
        'install_path',
        'file_hash_sha512',
        'hash_algo',
        'total_children',
        'completed_children',
        'failed_children',
        'file_name',
        'error_message',
        'install_log',
        'phase',
        'status',
        'started_at',
        'completed_at',
    ];

    protected $casts = [
        'started_at'   => 'datetime',
        'completed_at' => 'datetime',
    ];

    public const STATUS_PENDING    = 'pending';
    public const STATUS_DOWNLOADING = 'downloading';
    public const STATUS_COMPLETED  = 'completed';
    public const STATUS_FAILED     = 'failed';

    /** Terminal statuses — no worker is acting on these. */
    public const TERMINAL_STATUSES = [self::STATUS_COMPLETED, self::STATUS_FAILED];

    public function server(): BelongsTo
    {
        return $this->belongsTo(Server::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}

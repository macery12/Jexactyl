<?php

namespace Everest\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * @property int $id
 * @property int $server_id
 * @property int|null $actor_id
 * @property string $extension_id
 * @property string $action
 * @property array $files
 * @property User|null $actor
 */
class ExtensionFileSnapshot extends Model
{
    public const RESOURCE_NAME = 'extension_file_snapshot';

    protected $table = 'extension_file_snapshots';

    protected $fillable = [
        'server_id',
        'actor_id',
        'extension_id',
        'action',
        'files',
    ];

    protected $casts = [
        'server_id' => 'int',
        'actor_id' => 'int',
        'files' => 'array',
    ];

    public function server(): BelongsTo
    {
        return $this->belongsTo(Server::class);
    }

    public function actor(): BelongsTo
    {
        return $this->belongsTo(User::class, 'actor_id');
    }
}

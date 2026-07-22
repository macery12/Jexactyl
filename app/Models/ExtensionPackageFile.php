<?php

namespace Everest\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Factories\HasFactory;

/**
 * @property int $id
 * @property int $extension_package_id
 * @property string $path
 * @property string $operation
 * @property string $installed_checksum
 * @property string|null $backup_path
 * @property string|null $backup_checksum
 */
class ExtensionPackageFile extends Model
{
    use HasFactory;

    protected $table = 'extension_package_files';

    protected $fillable = [
        'extension_package_id',
        'path',
        'operation',
        'installed_checksum',
        'backup_path',
        'backup_checksum',
    ];

    public function package(): BelongsTo
    {
        return $this->belongsTo(ExtensionPackage::class, 'extension_package_id');
    }
}

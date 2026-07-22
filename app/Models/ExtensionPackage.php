<?php

namespace Everest\Models;

use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Factories\HasFactory;

/**
 * @property int $id
 * @property string $extension_id
 * @property string $package_id
 * @property string $name
 * @property string|null $description
 * @property string|null $author
 * @property string $icon
 * @property string|null $route
 * @property string $installed_version
 * @property int|null $source_repository_id
 * @property string|null $source_repository_name
 * @property string|null $source_registry_url
 * @property string|null $source_archive_url
 * @property string|null $package_checksum
 * @property array $manifest
 * @property \Carbon\Carbon|null $installed_at
 */
class ExtensionPackage extends Model
{
    use HasFactory;

    protected $table = 'extension_packages';

    protected $fillable = [
        'extension_id',
        'package_id',
        'name',
        'description',
        'author',
        'icon',
        'route',
        'installed_version',
        'source_repository_id',
        'source_repository_name',
        'source_registry_url',
        'source_archive_url',
        'package_checksum',
        'manifest',
        'installed_at',
    ];

    protected $casts = [
        'manifest' => 'array',
        'installed_at' => 'datetime',
    ];

    public function repository(): BelongsTo
    {
        return $this->belongsTo(ExtensionRepository::class, 'source_repository_id');
    }

    public function files(): HasMany
    {
        return $this->hasMany(ExtensionPackageFile::class, 'extension_package_id');
    }
}

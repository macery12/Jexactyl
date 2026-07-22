<?php

namespace Everest\Models;

use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Factories\HasFactory;

/**
 * @property int $id
 * @property string $slug
 * @property string $name
 * @property string $manifest_url
 * @property string|null $homepage_url
 * @property bool $enabled
 * @property bool $is_official
 * @property \Carbon\Carbon|null $risk_acknowledged_at
 */
class ExtensionRepository extends Model
{
    use HasFactory;

    protected $table = 'extension_repositories';

    protected $fillable = [
        'slug',
        'name',
        'manifest_url',
        'homepage_url',
        'enabled',
        'is_official',
        'risk_acknowledged_at',
    ];

    protected $casts = [
        'enabled' => 'boolean',
        'is_official' => 'boolean',
        'risk_acknowledged_at' => 'datetime',
    ];

    public function getRouteKeyName(): string
    {
        return $this->getKeyName();
    }

    public function packages(): HasMany
    {
        return $this->hasMany(ExtensionPackage::class, 'source_repository_id');
    }
}

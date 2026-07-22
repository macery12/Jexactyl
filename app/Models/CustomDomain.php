<?php

namespace Everest\Models;

use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class CustomDomain extends Model
{
    public const RESOURCE_NAME = 'custom_domain';

    protected $table = 'custom_domains';

    protected $guarded = ['id', self::CREATED_AT, self::UPDATED_AT];

    protected $casts = [
        'wildcard_enabled' => 'boolean',
        'enabled' => 'boolean',
        'allowed_nest_ids' => 'array',
        'allowed_egg_ids' => 'array',
        'egg_service_tags' => 'array',
    ];

    public static array $validationRules = [
        'domain' => ['required', 'string', 'max:191', 'regex:/^(?!-)[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/'],
        'cloudflare_zone_id' => 'nullable|string|max:191',
        'api_key_id' => 'nullable|integer|exists:custom_domain_api_keys,id',
        'allowed_nest_ids' => 'nullable|array',
        'allowed_nest_ids.*' => 'integer|exists:nests,id',
        'allowed_egg_ids' => 'nullable|array',
        'allowed_egg_ids.*' => 'integer|exists:eggs,id',
        'service_tag' => ['nullable', 'string', 'max:100', 'regex:/^(_?[a-z0-9][a-z0-9-]*|_[a-z0-9][a-z0-9-]*\._(?:tcp|udp)?|_[a-z0-9][a-z0-9-]*\._)$/i'],
        'egg_service_tags' => 'nullable|array',
        'egg_service_tags.*' => ['nullable', 'string', 'max:100', 'regex:/^(_?[a-z0-9][a-z0-9-]*|_[a-z0-9][a-z0-9-]*\._(?:tcp|udp)?|_[a-z0-9][a-z0-9-]*\._)$/i'],
        'wildcard_enabled' => 'boolean',
        'enabled' => 'boolean',
    ];

    public function apiKey(): BelongsTo
    {
        return $this->belongsTo(CustomDomainApiKey::class, 'api_key_id');
    }

    public function serverDomains(): HasMany
    {
        return $this->hasMany(ServerCustomDomain::class);
    }
}

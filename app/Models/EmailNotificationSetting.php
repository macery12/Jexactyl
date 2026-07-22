<?php

namespace Everest\Models;

/**
 * Everest\Models\EmailNotificationSetting.
 *
 * @property int $id
 * @property string $template_key
 * @property bool $enabled
 * @property string $category
 * @property string $name
 * @property string|null $description
 * @property bool $rate_limit_exempt
 * @property \Illuminate\Support\Carbon $created_at
 * @property \Illuminate\Support\Carbon $updated_at
 */
class EmailNotificationSetting extends Model
{
    protected $table = 'email_notification_settings';

    protected $fillable = [
        'template_key',
        'enabled',
        'category',
        'name',
        'description',
        'rate_limit_exempt',
    ];

    protected $casts = [
        'enabled' => 'boolean',
        'rate_limit_exempt' => 'boolean',
    ];

    /**
     * Check if a specific email type is enabled.
     */
    public static function isEnabled(string $templateKey): bool
    {
        return self::isTemplateEnabled($templateKey);
    }

    /**
     * Check if a specific template is enabled (ignores global switch).
     */
    public static function isTemplateEnabled(string $templateKey): bool
    {
        $setting = static::where('template_key', $templateKey)->first();

        return $setting ? (bool) $setting->enabled : false;
    }

    /**
     * Check if a template is exempt from rate limiting.
     */
    public static function isRateLimitExempt(string $templateKey): bool
    {
        $setting = static::where('template_key', $templateKey)->first();

        return $setting ? $setting->rate_limit_exempt : false;
    }

    /**
     * Get all enabled email types by category.
     */
    public static function getEnabledByCategory(string $category): \Illuminate\Database\Eloquent\Collection
    {
        return static::where('category', $category)
            ->where('enabled', true)
            ->get();
    }
}

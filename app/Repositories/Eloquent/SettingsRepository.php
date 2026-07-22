<?php

namespace Everest\Repositories\Eloquent;

use Everest\Models\Setting;
use Illuminate\Foundation\Application;
use Everest\Services\Security\SecretEncryptionService;
use Everest\Contracts\Repository\SettingsRepositoryInterface;

class SettingsRepository extends EloquentRepository implements SettingsRepositoryInterface
{
    private static array $cache = [];

    private static array $databaseMiss = [];

    /**
     * Return the model backing this repository.
     */
    public function model(): string
    {
        return Setting::class;
    }

    public function __construct(Application $app, private SecretEncryptionService $secrets)
    {
        parent::__construct($app);
    }

    /**
     * Store a new persistent setting in the database.
     *
     * @throws \Everest\Exceptions\Model\DataValidationException
     */
    public function set(string $key, ?string $value = null)
    {
        $normalizedKey = $this->secrets->normalizeKey($key);

        if ($this->secrets->isSecretKey($normalizedKey)) {
            $value = $this->secrets->encryptForStorage($value);
        }

        // Clear item from the cache.
        $this->clearCache($normalizedKey);
        $this->withoutFreshModel()->updateOrCreate(['key' => $normalizedKey], ['value' => $value ?? '']);

        $cached = $value;
        if ($this->secrets->isSecretKey($normalizedKey)) {
            $cached = $this->secrets->decryptFromStorage($value);
        }

        self::$cache[$normalizedKey] = $cached;
    }

    /**
     * Retrieve a persistent setting from the database.
     */
    public function get(string $key, mixed $default = null): mixed
    {
        $normalizedKey = $this->secrets->normalizeKey($key);

        // If item has already been requested return it from the cache. If
        // we already know it is missing, immediately return the default value.
        if (array_key_exists($normalizedKey, self::$cache)) {
            return self::$cache[$normalizedKey];
        } elseif (array_key_exists($normalizedKey, self::$databaseMiss)) {
            return value($default);
        }

        /** @var Setting $instance */
        $instance = $this->getBuilder()->where('key', $normalizedKey)->first();
        if (is_null($instance)) {
            self::$databaseMiss[$normalizedKey] = true;

            return value($default);
        }

        $value = $instance->value;
        if ($this->secrets->isSecretKey($normalizedKey)) {
            $value = $this->secrets->decryptFromStorage($value);
        }

        return self::$cache[$normalizedKey] = $value;
    }

    /**
     * Remove a key from the database cache.
     */
    public function forget(string $key)
    {
        $normalizedKey = $this->secrets->normalizeKey($key);

        $this->clearCache($normalizedKey);
        $this->deleteWhere(['key' => $normalizedKey]);
    }

    /**
     * Remove a key from the cache.
     */
    private function clearCache(string $key)
    {
        unset(self::$cache[$key], self::$databaseMiss[$key]);
    }

    /**
     * Return all settings with secrets transparently decrypted.
     *
     * This overrides the base repository to ensure callers never receive raw
     * encrypted payloads for sensitive keys.
     */
    public function all(): \Illuminate\Support\Collection
    {
        return parent::all()->map(function (Setting $setting) {
            if ($this->secrets->isSecretKey($setting->key)) {
                $setting->value = $this->secrets->decryptFromStorage($setting->value);
            }

            return $setting;
        });
    }
}

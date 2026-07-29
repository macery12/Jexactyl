<?php

namespace Everest\Transformers\Api\Client;

use Everest\Models\User;
use Illuminate\Support\Str;
use Everest\Models\ActivityLog;
use League\Fractal\Resource\Item;
use Illuminate\Support\Facades\Log;
use Illuminate\Database\Eloquent\Model;
use Everest\Transformers\Api\Transformer;
use League\Fractal\Resource\NullResource;
use Everest\Services\Security\LogSanitizer;

class ActivityLogTransformer extends Transformer
{
    protected array $availableIncludes = ['actor'];

    public function getResourceName(): string
    {
        return ActivityLog::RESOURCE_NAME;
    }

    public function transform(ActivityLog $model): array
    {
        return [
            // This is not for security, it is only to provide a unique identifier to
            // the front-end for each entry to improve rendering performance since there
            // is nothing else sufficiently unique to key off at this point.
            'id' => sha1($model->id),
            'batch' => $model->batch,
            'event' => $model->event,
            'is_api' => !is_null($model->api_key_id),
            'is_admin' => (bool) $model->is_admin,
            'ip' => $this->canViewIP($model->actor) ? $model->ip : null,
            'description' => $model->description,
            'properties' => $this->properties($model),
            'has_additional_metadata' => $this->hasAdditionalMetadata($model),
            'timestamp' => $model->timestamp,
            'scope' => $this->scope($model),
            'context' => $this->context($model),
            'category' => $this->category($model),
            'source' => $this->source($model),
            'severity' => $this->severity($model),
        ];
    }

    public function includeActor(ActivityLog $model): Item|NullResource
    {
        if (!$model->actor instanceof User) {
            return $this->null();
        }

        return $this->item($model->actor, new UserTransformer());
    }

    /**
     * Transforms any array values in the properties into a countable field for easier
     * use within the translation outputs.
     */
    protected function properties(ActivityLog $model): object
    {
        $propertiesCollection = collect(LogSanitizer::redactSensitivePayload(
            $model->properties instanceof \Illuminate\Support\Collection
                ? $model->properties->toArray()
                : (array) ($model->properties ?? [])
        ));

        if ($propertiesCollection->isEmpty()) {
            return (object) [];
        }

        $properties = $propertiesCollection
            ->mapWithKeys(function ($value, $key) use ($model) {
                if ($key === 'ip' && !optional($model->actor)->is($this->request->user())) {
                    return [$key => '[hidden]'];
                }

                if (!is_array($value)) {
                    // Perform some directory normalization at this point.
                    if ($key === 'directory') {
                        $value = str_replace('//', '/', '/' . trim($value, '/') . '/');
                    }

                    return [$key => $value];
                }

                return [$key => $value, "{$key}_count" => count($value)];
            });

        $keys = $properties->keys()->filter(fn ($key) => Str::endsWith($key, '_count'))->values();
        if ($keys->containsOneItem()) {
            $properties = $properties->merge(['count' => $properties->get($keys[0])])->except($keys[0]);
        }

        return (object) $properties->toArray();
    }

    /**
     * Determines if there are any log properties that we've not already exposed
     * in the response language string and that are not just the IP address or
     * the browser useragent.
     *
     * This is used by the front-end to selectively display an "additional metadata"
     * button that is pointless if there is nothing the user can't already see from
     * the event description.
     */
    protected function hasAdditionalMetadata(ActivityLog $model): bool
    {
        $propertiesCollection = $model->properties instanceof \Illuminate\Support\Collection
            ? $model->properties
            : collect($model->properties ?? []);

        if ($propertiesCollection->isEmpty()) {
            return false;
        }

        $translation = trans('activity.' . str_replace(':', '.', $model->event));
        $str = is_string($translation) ? $translation : '';
        preg_match_all('/:(?<key>[\w.-]+\w)(?:[^\w:]?|$)/', $str, $matches);

        $exclude = array_merge($matches['key'], ['ip', 'useragent', 'using_sftp']);
        foreach ($propertiesCollection->keys() as $key) {
            if (!in_array($key, $exclude, true)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Determines if the user can view the IP address in the output either because they are the
     * actor that performed the action, or because they are an administrator on the Panel.
     */
    protected function canViewIP(?Model $actor = null): bool
    {
        return optional($actor)->is($this->request->user()) || $this->request->user()->isOwner();
    }

    protected function scope(ActivityLog $model): string
    {
        $inferred = $this->inferScope($model);
        if ($model->scope && $model->scope !== $inferred) {
            Log::warning('activity.scope_mismatch', [
                'id' => $model->id,
                'scope' => $model->scope,
                'inferred' => $inferred,
                'event' => $model->event,
            ]);
        }

        return $model->scope ?? $inferred;
    }

    protected function inferScope(ActivityLog $model): string
    {
        if (!is_null($model->server_id)) {
            return 'server';
        }

        if ($model->is_admin) {
            return 'admin';
        }

        return 'account';
    }

    protected function context(ActivityLog $model): string
    {
        $context = $model->properties?->get('context');

        if (is_string($context)) {
            return $context;
        }

        return $model->is_admin ? 'admin' : 'client';
    }

    protected function category(ActivityLog $model): string
    {
        $event = $model->event;

        return match (true) {
            Str::startsWith($event, 'auth:') => 'auth',
            Str::startsWith($event, 'server:file') => 'files',
            Str::startsWith($event, 'server:backup') => 'backups',
            Str::startsWith($event, ['server:plugin', 'server:mod', 'server:install']) => 'plugins',
            Str::startsWith($event, 'server:') => 'server',
            default => 'admin',
        };
    }

    protected function source(ActivityLog $model): string
    {
        $source = $model->properties?->get('source');

        if (is_string($source)) {
            return $source;
        }

        if ($model->api_key_id) {
            return 'api';
        }

        return 'panel';
    }

    protected function severity(ActivityLog $model): string
    {
        if (Str::startsWith($model->event, 'auth:failed')) {
            return 'critical';
        }

        if (Str::contains($model->event, ['failed', 'error', 'denied'])) {
            return 'warning';
        }

        return 'info';
    }
}

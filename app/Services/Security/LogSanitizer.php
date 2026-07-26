<?php

namespace Everest\Services\Security;

class LogSanitizer
{
    public const REDACTED_VALUE = '[REDACTED]';

    public const DEFAULT_SENSITIVE_KEYS = [
        'api_key',
        'apikey',
        'authorization',
        'client_secret',
        'command',
        'credential',
        'id_token',
        'passphrase',
        'password',
        'private_key',
        'refresh_token',
        'secret',
        'token',
    ];

    public static function redactSensitivePayload(array $payload, array $sensitiveKeys = self::DEFAULT_SENSITIVE_KEYS): array
    {
        // Some settings APIs carry the secret's name in one field and its
        // value in another: {"key":"...client_secret","value":"..."}.
        if (
            isset($payload['key'])
            && is_string($payload['key'])
            && array_key_exists('value', $payload)
        ) {
            if (self::isSensitiveDescriptor($payload['key'], $sensitiveKeys)) {
                $payload['value'] = self::REDACTED_VALUE;
            } elseif (self::isUrlKey($payload['key']) && is_string($payload['value'])) {
                $payload['value'] = self::sanitizeUrlForLogging($payload['value']);
            }
        }

        // Startup-variable activity uses the variable name as a sibling of
        // generic `old` and `new` fields. Treat the descriptor as the key so
        // values such as RCON_PASSWORD and AWS_SECRET_ACCESS_KEY never persist.
        if (
            isset($payload['variable'])
            && is_string($payload['variable'])
            && self::isSensitiveDescriptor($payload['variable'], $sensitiveKeys)
        ) {
            foreach (['old', 'new', 'value', 'payload'] as $valueKey) {
                if (array_key_exists($valueKey, $payload)) {
                    $payload[$valueKey] = self::REDACTED_VALUE;
                }
            }
        }

        // Scheduled console tasks encode the sensitive command in a generic
        // `payload` sibling, so key matching alone cannot recognize it. This
        // also scrubs historical activity rows at transformation time.
        if (
            isset($payload['action'])
            && is_string($payload['action'])
            && strtolower($payload['action']) === 'command'
            && array_key_exists('payload', $payload)
        ) {
            $payload['payload'] = self::REDACTED_VALUE;
        }

        foreach ($payload as $key => $value) {
            if (self::isSensitiveKey((string) $key, $sensitiveKeys)) {
                $payload[$key] = self::REDACTED_VALUE;
                continue;
            }

            if (is_array($value)) {
                $payload[$key] = self::redactSensitivePayload($value, $sensitiveKeys);
            } elseif (is_string($value) && self::isUrlKey((string) $key)) {
                $payload[$key] = self::sanitizeUrlForLogging($value);
            }
        }

        return $payload;
    }

    public static function maskIdentifier(?string $value, int $visiblePrefix = 4, int $visibleSuffix = 4): ?string
    {
        if ($value === null || $value === '') {
            return $value;
        }

        $length = strlen($value);
        if ($length <= ($visiblePrefix + $visibleSuffix)) {
            return self::REDACTED_VALUE;
        }

        return substr($value, 0, $visiblePrefix) . '...' . substr($value, -$visibleSuffix);
    }

    public static function sanitizeUrlForLogging(?string $url): ?string
    {
        if ($url === null || $url === '') {
            return $url;
        }

        $parts = parse_url($url);
        if ($parts === false) {
            return self::REDACTED_VALUE;
        }

        $sanitized = '';

        if (isset($parts['scheme'])) {
            $sanitized .= $parts['scheme'] . '://';
        }

        if (isset($parts['host'])) {
            $sanitized .= $parts['host'];
        }

        if (isset($parts['port'])) {
            $sanitized .= ':' . $parts['port'];
        }

        if (!empty($parts['path']) && $parts['path'] !== '/') {
            $sanitized .= '/[REDACTED_PATH]';
        } elseif (($parts['path'] ?? null) === '/') {
            $sanitized .= '/';
        }

        if (array_key_exists('query', $parts)) {
            $sanitized .= '?[REDACTED_QUERY]';
        }

        return $sanitized;
    }

    public static function summarizeProviderPayload(array|string|null $payload): array
    {
        if (is_string($payload)) {
            return $payload === '' ? [] : ['body_present' => true];
        }

        if (!is_array($payload) || $payload === []) {
            return [];
        }

        $summary = [];

        foreach (['name', 'error', 'message', 'error_description', 'debug_id'] as $key) {
            if (isset($payload[$key])) {
                $summary[$key] = $payload[$key];
            }
        }

        if (isset($payload['details']) && is_array($payload['details'])) {
            $summary['detail_count'] = count($payload['details']);
        }

        if (isset($payload['errors']) && is_array($payload['errors'])) {
            $summary['error_count'] = count($payload['errors']);
        }

        if ($summary === []) {
            $summary['keys'] = array_slice(array_keys($payload), 0, 5);
        }

        return self::redactSensitivePayload($summary);
    }

    public static function exceptionContext(\Throwable $exception): array
    {
        $context = [
            'exception' => $exception::class,
            'message' => $exception->getMessage(),
        ];

        if (config('app.debug')) {
            $context['trace'] = $exception->getTraceAsString();
        }

        return $context;
    }

    private static function isSensitiveKey(string $key, array $sensitiveKeys): bool
    {
        foreach ($sensitiveKeys as $sensitiveKey) {
            if (stripos($key, (string) $sensitiveKey) !== false) {
                return true;
            }
        }

        return false;
    }

    private static function isSensitiveDescriptor(string $key, array $sensitiveKeys): bool
    {
        if (self::isSensitiveKey($key, $sensitiveKeys)) {
            return true;
        }

        $separated = preg_replace('/([a-z0-9])([A-Z])/', '$1_$2', $key) ?? $key;
        $tokens = preg_split('/[^a-z0-9]+/', strtolower($separated), -1, PREG_SPLIT_NO_EMPTY) ?: [];
        if (array_intersect($tokens, ['auth', 'credential', 'credentials', 'pass', 'passwd', 'pwd'])) {
            return true;
        }

        $normalized = preg_replace('/[^a-z0-9]+/', '', strtolower($key)) ?? '';

        return str_contains($normalized, 'accesskey')
            || str_contains($normalized, 'databaseurl')
            || str_contains($normalized, 'datasourcename')
            || str_contains($normalized, 'privatekey')
            || str_contains($normalized, 'signingkey')
            || str_contains($normalized, 'webhook')
            || str_ends_with($normalized, 'dsn');
    }

    private static function isUrlKey(string $key): bool
    {
        $normalized = preg_replace('/[^a-z0-9]+/', '', strtolower($key)) ?? '';

        return in_array($normalized, ['url', 'uri', 'endpoint'], true)
            || str_ends_with($normalized, 'url')
            || str_ends_with($normalized, 'uri');
    }
}

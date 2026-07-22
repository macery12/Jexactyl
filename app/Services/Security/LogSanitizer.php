<?php

namespace Everest\Services\Security;

use Everest\Services\Email\EmailRedactor;

class LogSanitizer
{
    public const REDACTED_VALUE = '[REDACTED]';

    public const DEFAULT_SENSITIVE_KEYS = [
        'api_key',
        'apikey',
        'authorization',
        'client_secret',
        'id_token',
        'password',
        'refresh_token',
        'secret',
        'token',
    ];

    public static function redactSensitivePayload(array $payload, array $sensitiveKeys = self::DEFAULT_SENSITIVE_KEYS): array
    {
        return EmailRedactor::redactSensitivePayload($payload, $sensitiveKeys);
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

        $sanitized .= $parts['path'] ?? '';

        if (!empty($parts['query'])) {
            parse_str($parts['query'], $query);

            if (!empty($query)) {
                $query = self::redactSensitivePayload($query);
                $sanitized .= '?' . http_build_query($query);
            } else {
                $sanitized .= '?[REDACTED_QUERY]';
            }
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
}

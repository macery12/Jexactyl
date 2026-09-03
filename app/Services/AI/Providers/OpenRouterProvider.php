<?php

namespace Everest\Services\AI\Providers;

use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Cache;
use Everest\Services\AI\Data\AiMessage;
use Everest\Services\AI\Data\AiRequest;
use GuzzleHttp\Exception\GuzzleException;
use GuzzleHttp\Exception\RequestException;
use Everest\Services\AI\Data\ProviderCapabilities;
use Everest\Exceptions\Service\AI\AIServiceException;

/** First-class OpenRouter free-router driver. */
class OpenRouterProvider extends OpenAiCompatibleProvider
{
    public const ENDPOINT = 'https://openrouter.ai/api/v1';
    public const MODEL = 'openrouter/free';

    public const INVALID_KEY_MESSAGE = 'OpenRouter rejected the API key. Ask an administrator to replace an invalid, disabled, expired, or revoked key.';
    public const CREDITS_MESSAGE = 'OpenRouter reports insufficient credits or API-key spending allowance. Ask an administrator to review the key limit and account credits.';
    public const RATE_LIMIT_MESSAGE = 'OpenRouter\'s free-model rate limit has been reached. Please wait before trying again.';
    public const POLICY_MESSAGE = 'OpenRouter or an upstream model rejected this request because of a content policy, moderation, permission, or guardrail rule.';
    public const NO_ELIGIBLE_MODEL_MESSAGE = 'OpenRouter could not find an available free model that supports this request\'s tools, privacy, and required parameters. Please try again later.';
    public const PAYLOAD_TOO_LARGE_MESSAGE = 'The request is too large for the available OpenRouter free models. Shorten the conversation or attached context and try again.';
    public const TEMPORARILY_UNAVAILABLE_MESSAGE = 'OpenRouter or its upstream free models are overloaded, timed out, or temporarily unavailable. Please try again later.';
    public const INVALID_RESPONSE_MESSAGE = 'OpenRouter returned a response the panel could not safely read. Please try again; if it continues, ask an administrator to check the provider logs.';
    public const EMPTY_RESPONSE_MESSAGE = 'OpenRouter returned an empty completion with no text or tool calls. Please try again.';
    public const INTERRUPTED_STREAM_MESSAGE = 'The OpenRouter response stream ended before completion. Please try again.';

    protected function resolveModel(AiRequest $request): string
    {
        return self::MODEL;
    }

    protected function buildPayload(AiRequest $request, bool $stream): array
    {
        $payload = parent::buildPayload($request, $stream);
        $payload['model'] = self::MODEL;
        $payload['provider'] = [
            // Do not opt into strict ZDR: the free router may otherwise have no
            // eligible models. This still excludes providers OpenRouter marks
            // as collecting user data.
            'data_collection' => 'deny',
            'require_parameters' => true,
        ];
        if ($request->reasoning) {
            $payload['reasoning'] = ['enabled' => true];
        }

        return $payload;
    }

    protected function serialiseMessage(AiMessage $message): array
    {
        $serialized = parent::serialiseMessage($message);

        if ($message->role === AiMessage::ROLE_ASSISTANT && $message->reasoning !== []) {
            // OpenRouter requires this ordered sequence back byte-for-byte in
            // meaning across a tool continuation, even if the router selects a
            // different compatible free model for the next step.
            $serialized['reasoning_details'] = array_values($message->reasoning);
        }

        return $serialized;
    }

    protected function strictResponseValidation(): bool
    {
        return true;
    }

    protected function requiresStreamCompletionMarker(): bool
    {
        return true;
    }

    protected function reasoningDetailsFromDelta(array $delta): array
    {
        if (!is_array($delta['reasoning_details'] ?? null)) {
            return [];
        }

        return array_values(array_filter($delta['reasoning_details'], 'is_array'));
    }

    protected function invalidResponseException(): AIServiceException
    {
        $this->rememberFailure(self::INVALID_RESPONSE_MESSAGE, true);

        return new AIServiceException(self::INVALID_RESPONSE_MESSAGE);
    }

    protected function emptyResponseException(): AIServiceException
    {
        $this->rememberFailure(self::EMPTY_RESPONSE_MESSAGE, true);

        return new AIServiceException(self::EMPTY_RESPONSE_MESSAGE);
    }

    protected function interruptedStreamException(): AIServiceException
    {
        $this->rememberFailure(self::INTERRUPTED_STREAM_MESSAGE, true);

        return new AIServiceException(self::INTERRUPTED_STREAM_MESSAGE);
    }

    protected function providerErrorException(mixed $error): AIServiceException
    {
        $type = $this->allowlistedErrorType($error);
        if ($type === null) {
            $this->rememberFailure(self::PROVIDER_REJECTED_MESSAGE);

            return new AIServiceException(self::PROVIDER_REJECTED_MESSAGE);
        }

        [$message, $temporary] = $this->classifiedFailure($type, null, null);
        $this->rememberFailure($message, $temporary);

        return new AIServiceException($message);
    }

    protected function transportErrorMessageFromException(GuzzleException $e, ?int $status): string
    {
        $error = null;
        $retryAfter = null;

        if ($e instanceof RequestException && $e->hasResponse()) {
            $response = $e->getResponse();
            $decoded = json_decode($response->getBody()->getContents(), true);
            if (is_array($decoded) && array_key_exists('error', $decoded)) {
                $error = $decoded['error'];
            }
            $retryAfter = $this->validatedRetryAfter($response->getHeaderLine('Retry-After'));
        }

        $type = $this->allowlistedErrorType($error);
        $allowedStatus = $this->allowlistedStatus($status);

        // A response status outside the explicit allowlist conveys no trusted
        // classification. Keep it generic instead of treating it like a
        // network failure, where no response status exists at all.
        if ($type === null && $status !== null && $allowedStatus === null) {
            return self::PROVIDER_REJECTED_MESSAGE;
        }

        [$message] = $this->classifiedFailure($type, $allowedStatus, $retryAfter);

        return $message;
    }

    protected function transportFailureIsTemporarilyUnavailable(?int $status): bool
    {
        return $status === null || in_array($status, [404, 408, 429, 500, 502, 503, 504], true);
    }

    /**
     * Validate credentials without spending inference tokens, then verify the
     * exact router catalog entry used by this integration.
     */
    public function health(): bool
    {
        try {
            $this->assertConfigured();
            $key = $this->getJson('key', $this->providerConfig->connectTimeout);
            if (!is_array($key['data'] ?? null)) {
                throw $this->invalidResponseException();
            }

            $keyData = $key['data'];
            if (is_string($keyData['expires_at'] ?? null)) {
                $expiresAt = strtotime($keyData['expires_at']);
                if ($expiresAt !== false && $expiresAt <= time()) {
                    $this->rememberFailure(self::INVALID_KEY_MESSAGE);

                    return false;
                }
            }

            $model = $this->modelMetadata(true);
            if (($model['id'] ?? null) !== self::MODEL) {
                $this->rememberFailure(self::NO_ELIGIBLE_MODEL_MESSAGE, true);

                return false;
            }

            return true;
        } catch (AIServiceException $e) {
            if ($this->lastFailure() === null) {
                $this->rememberFailure($e->getMessage());
            }

            return false;
        } catch (\Throwable $e) {
            Log::warning('OpenRouter health check failed.', ['exception' => $e::class]);
            $this->rememberFailure(self::TEMPORARILY_UNAVAILABLE_MESSAGE, true);

            return false;
        }
    }

    /** The admin selector intentionally exposes only the managed free router. */
    public function listModels(): array
    {
        return [['id' => self::MODEL, 'size' => null]];
    }

    public function capabilities(?string $model = null): ProviderCapabilities
    {
        try {
            $metadata = $this->modelMetadata();
            $parameters = array_values(array_filter(
                is_array($metadata['supported_parameters'] ?? null) ? $metadata['supported_parameters'] : [],
                'is_string',
            ));

            return new ProviderCapabilities(
                supportsTools: in_array('tools', $parameters, true),
                supportsStructuredOutput: in_array('structured_outputs', $parameters, true)
                    || in_array('response_format', $parameters, true),
                supportsParallelToolCalls: in_array('tools', $parameters, true),
                supportsSampling: in_array('temperature', $parameters, true),
                supportsReasoning: in_array('reasoning', $parameters, true),
                selfHosted: false,
                maxContextTokens: isset($metadata['context_length']) ? (int) $metadata['context_length'] : null,
                toolSupportVerified: true,
            );
        } catch (\Throwable $e) {
            Log::warning('OpenRouter capability lookup failed.', ['exception' => $e::class]);

            return ProviderCapabilities::unknown('OpenRouter capability metadata is temporarily unavailable.');
        }
    }

    private function modelMetadata(bool $fresh = false): array
    {
        $key = 'ai:openrouter:model:' . $this->providerConfig->fingerprint();
        if ($fresh) {
            Cache::forget($key);
        }

        return Cache::remember($key, self::PROBE_CACHE_TTL, function (): array {
            $response = $this->getJson('model/openrouter/free', $this->providerConfig->connectTimeout);
            $model = $response['data'] ?? null;

            if (!is_array($model)) {
                throw $this->invalidResponseException();
            }

            return $model;
        });
    }

    private function allowlistedErrorType(mixed $error): ?string
    {
        $type = is_array($error) ? ($error['metadata']['error_type'] ?? null) : null;
        if (!is_string($type)) {
            return null;
        }

        return in_array($type, [
            'authentication',
            'permission_denied',
            'payment_required',
            'rate_limit_exceeded',
            'provider_overloaded',
            'provider_unavailable',
            'invalid_request',
            'invalid_prompt',
            'not_found',
            'payload_too_large',
            'unprocessable',
            'context_length_exceeded',
            'max_tokens_exceeded',
            'token_limit_exceeded',
            'content_policy_violation',
            'refusal',
            'server',
            'timeout',
            'unmapped',
        ], true) ? $type : null;
    }

    private function allowlistedStatus(?int $status): ?int
    {
        return in_array($status, [400, 401, 402, 403, 404, 408, 409, 413, 422, 429, 500, 502, 503, 504], true)
            ? $status
            : null;
    }

    /** @return array{0: string, 1: bool} safe message and temporary flag */
    private function classifiedFailure(?string $type, ?int $status, ?int $retryAfter): array
    {
        if ($type === 'authentication' || $status === 401) {
            return [self::INVALID_KEY_MESSAGE, false];
        }
        if ($type === 'payment_required' || $status === 402) {
            return [self::CREDITS_MESSAGE, false];
        }
        if ($type === 'rate_limit_exceeded' || $status === 429) {
            $message = self::RATE_LIMIT_MESSAGE;
            if ($retryAfter !== null) {
                $message .= sprintf(' Try again in %s.', $this->formatRetryAfter($retryAfter));
            }

            return [$message, true];
        }
        if (in_array($type, ['permission_denied', 'content_policy_violation', 'refusal'], true) || $status === 403) {
            return [self::POLICY_MESSAGE, false];
        }
        if ($type === 'not_found' || $status === 404) {
            return [self::NO_ELIGIBLE_MODEL_MESSAGE, true];
        }
        if (in_array($type, ['payload_too_large', 'context_length_exceeded', 'max_tokens_exceeded', 'token_limit_exceeded'], true) || $status === 413) {
            return [self::PAYLOAD_TOO_LARGE_MESSAGE, false];
        }
        if (in_array($type, ['provider_overloaded', 'provider_unavailable', 'server', 'timeout', 'unmapped'], true)
            || in_array($status, [408, 500, 502, 503, 504], true)
            || $status === null) {
            return [self::TEMPORARILY_UNAVAILABLE_MESSAGE, true];
        }
        if (in_array($type, ['invalid_request', 'invalid_prompt', 'unprocessable'], true)
            || in_array($status, [400, 409, 422], true)) {
            return [self::INCOMPATIBLE_REQUEST_MESSAGE, false];
        }

        return [self::PROVIDER_REJECTED_MESSAGE, false];
    }

    private function validatedRetryAfter(string $value): ?int
    {
        $value = trim($value);
        if ($value === '') {
            return null;
        }

        if (ctype_digit($value)) {
            $seconds = (int) $value;
        } else {
            $timestamp = strtotime($value);
            $seconds = $timestamp === false ? 0 : $timestamp - time();
        }

        return $seconds >= 1 && $seconds <= 86400 ? $seconds : null;
    }

    private function formatRetryAfter(int $seconds): string
    {
        if ($seconds < 60) {
            return $seconds . ' second' . ($seconds === 1 ? '' : 's');
        }

        $minutes = (int) ceil($seconds / 60);

        return $minutes . ' minute' . ($minutes === 1 ? '' : 's');
    }
}

<?php

namespace Everest\Services\AI\Agent;

use Everest\Services\AI\Data\ProviderConfig;
use Everest\Services\AI\Data\ProviderCapabilities;

/**
 * Classify a model into a conservative tool-discrimination tier.
 *
 * This is deliberately deterministic. Asking the configured model how capable
 * it is would make the weakest model responsible for sizing its own prompt and
 * would consume an inference request merely to open the settings page.
 */
class ModelToolProfileDetector
{
    public const SOURCE_METADATA = 'metadata';
    public const SOURCE_MODEL_NAME = 'model_name';
    public const SOURCE_PROVIDER_FAMILY = 'provider_family';
    public const SOURCE_MODEL_BYTES = 'model_bytes';
    public const SOURCE_FALLBACK = 'fallback';

    public const CONFIDENCE_HIGH = 'high';
    public const CONFIDENCE_MEDIUM = 'medium';
    public const CONFIDENCE_LOW = 'low';

    /**
     * @return array{profile: string, source: string, confidence: string, reason: string, parameter_count: ?int}
     */
    public function detect(
        string $provider,
        string $model,
        ?ProviderCapabilities $capabilities = null,
    ): array {
        // The configured driver is authoritative. An Ollama probe failure uses
        // ProviderCapabilities::unknown(), whose generic default is not
        // self-hosted; trusting that default would promote an unreachable local
        // 1.7B model to the hosted fallback.
        $selfHosted = match (true) {
            in_array($provider, ProviderConfig::SELF_HOSTED, true) => true,
            in_array($provider, [ProviderConfig::PROVIDER_OPENAI, ProviderConfig::PROVIDER_ANTHROPIC], true) => false,
            default => $capabilities === null ? true : $capabilities->selfHosted,
        };

        if (!$selfHosted) {
            return $this->hosted($provider);
        }

        // MoE filenames commonly state both total and active parameters, for
        // example 35B-A3B. The active count is the conservative choice for a
        // prompt-discrimination budget; a measured calibration can promote it
        // later, while treating it as a dense 35B model can overwhelm it before
        // it gets a chance to demonstrate anything.
        $activeParameters = $this->activeParameterCountFromName($model);
        if ($activeParameters !== null) {
            return $this->fromParameters(
                $activeParameters,
                self::SOURCE_MODEL_NAME,
                self::CONFIDENCE_MEDIUM,
                sprintf('Detected %s active parameters from the mixture-of-experts model name.', $this->formatParameters($activeParameters)),
            );
        }

        $parameterCount = $capabilities?->modelParameterCount;
        if ($parameterCount !== null && $parameterCount > 0) {
            return $this->fromParameters(
                $parameterCount,
                self::SOURCE_METADATA,
                self::CONFIDENCE_HIGH,
                sprintf('Detected %s parameters from provider metadata.', $this->formatParameters($parameterCount)),
            );
        }

        $parameterCount = $this->parameterCountFromName($model);
        if ($parameterCount !== null) {
            return $this->fromParameters(
                $parameterCount,
                self::SOURCE_MODEL_NAME,
                self::CONFIDENCE_MEDIUM,
                sprintf('Detected %s parameters from the model name.', $this->formatParameters($parameterCount)),
            );
        }

        $bytes = $capabilities?->modelSizeBytes;
        if ($bytes !== null && $bytes > 0) {
            $profile = match (true) {
                $bytes < 6 * 1024 * 1024 * 1024 => ToolBudget::PROFILE_SMALL,
                $bytes < 14 * 1024 * 1024 * 1024 => ToolBudget::PROFILE_MEDIUM,
                default => ToolBudget::PROFILE_LARGE,
            };

            return $this->result(
                $profile,
                self::SOURCE_MODEL_BYTES,
                self::CONFIDENCE_MEDIUM,
                'Estimated the tier from quantized model size because no parameter count was available.',
            );
        }

        return $this->result(
            ToolBudget::PROFILE_SMALL,
            self::SOURCE_FALLBACK,
            self::CONFIDENCE_LOW,
            'No model size was available, so the conservative local-model default was used.',
        );
    }

    /**
     * Extract the first explicit parameter count from a local model identifier.
     *
     * `Qwen3-1.7B-Q8_0.gguf` therefore yields 1.7B. Q8_0 has no B suffix and is
     * correctly left as quantization metadata. A leading `8x7B` mixture is
     * treated as its conservative total before looking for ordinary labels.
     */
    public function parameterCountFromName(string $model): ?int
    {
        $name = basename(str_replace('\\', '/', trim($model)));

        if (preg_match('/(?<![A-Za-z0-9])(\d+)\s*[xX]\s*(\d+(?:\.\d+)?)\s*[Bb](?![A-Za-z])/', $name, $match) === 1) {
            return (int) round((int) $match[1] * (float) $match[2] * 1_000_000_000);
        }

        if (preg_match('/(?<![A-Za-z0-9])(\d+(?:\.\d+)?)\s*[Bb](?![A-Za-z])/', $name, $match) !== 1) {
            return null;
        }

        return (int) round((float) $match[1] * 1_000_000_000);
    }

    public function activeParameterCountFromName(string $model): ?int
    {
        $name = basename(str_replace('\\', '/', trim($model)));

        if (preg_match('/(?<![A-Za-z0-9])A(\d+(?:\.\d+)?)\s*[Bb](?![A-Za-z])/i', $name, $match) !== 1) {
            return null;
        }

        return (int) round((float) $match[1] * 1_000_000_000);
    }

    /**
     * @return array{profile: string, source: string, confidence: string, reason: string, parameter_count: ?int}
     */
    private function hosted(string $provider): array
    {
        return $this->result(
            ToolBudget::PROFILE_FRONTIER,
            self::SOURCE_PROVIDER_FAMILY,
            self::CONFIDENCE_HIGH,
            sprintf(
                'Hosted %s models receive the complete permitted tool surface; model-size tiers apply only to self-hosted providers.',
                $provider === ProviderConfig::PROVIDER_ANTHROPIC ? 'Anthropic' : 'OpenAI',
            ),
        );
    }

    /**
     * @return array{profile: string, source: string, confidence: string, reason: string, parameter_count: int}
     */
    private function fromParameters(int $parameters, string $source, string $confidence, string $reason): array
    {
        $billions = $parameters / 1_000_000_000;

        $profile = match (true) {
            $billions <= 3 => ToolBudget::PROFILE_TINY,
            $billions <= 7 => ToolBudget::PROFILE_SMALL,
            $billions <= 14 => ToolBudget::PROFILE_MEDIUM,
            default => ToolBudget::PROFILE_LARGE,
        };

        return $this->result($profile, $source, $confidence, $reason, $parameters);
    }

    /**
     * @return array{profile: string, source: string, confidence: string, reason: string, parameter_count: ?int}
     */
    private function result(
        string $profile,
        string $source,
        string $confidence,
        string $reason,
        ?int $parameterCount = null,
    ): array {
        return [
            'profile' => $profile,
            'source' => $source,
            'confidence' => $confidence,
            'reason' => $reason,
            'parameter_count' => $parameterCount,
        ];
    }

    private function formatParameters(int $parameters): string
    {
        if ($parameters >= 1_000_000_000) {
            return rtrim(rtrim(number_format($parameters / 1_000_000_000, 2, '.', ''), '0'), '.') . 'B';
        }

        return rtrim(rtrim(number_format($parameters / 1_000_000, 2, '.', ''), '0'), '.') . 'M';
    }
}

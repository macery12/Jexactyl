<?php

namespace Everest\Services\AI\Data;

/**
 * What a configured provider + model can actually do.
 *
 * Resolved per model rather than per driver: an Ollama endpoint running
 * qwen3 supports tools while the same endpoint running a base completion
 * model does not, and the agent must refuse to start in the second case
 * instead of silently producing prose where tool calls were expected.
 */
class ProviderCapabilities
{
    /**
     * @param bool $supportsSampling whether `temperature` and its siblings are
     *                               accepted at all. False on the models that
     *                               reject them outright — the driver drops the
     *                               parameter there, so a panel that goes on
     *                               presenting a temperature control is
     *                               offering a knob attached to nothing.
     * @param bool $selfHosted whether inference runs on hardware we own, and
     *                         therefore needs slot-based admission control
     * @param string[] $warnings admin-facing problems that do not block use
     */
    public function __construct(
        public readonly bool $supportsTools,
        public readonly bool $supportsStreaming = true,
        public readonly bool $supportsStructuredOutput = false,
        public readonly bool $supportsParallelToolCalls = true,
        public readonly bool $supportsSampling = true,
        public readonly bool $selfHosted = false,
        public readonly ?int $maxContextTokens = null,
        public readonly ?int $modelSizeBytes = null,
        public readonly array $warnings = [],
    ) {
    }

    public static function unknown(string $reason): self
    {
        return new self(
            supportsTools: false,
            warnings: [$reason],
        );
    }

    public function toArray(): array
    {
        return [
            'supports_tools' => $this->supportsTools,
            'supports_streaming' => $this->supportsStreaming,
            'supports_structured_output' => $this->supportsStructuredOutput,
            'supports_parallel_tool_calls' => $this->supportsParallelToolCalls,
            'supports_sampling' => $this->supportsSampling,
            'self_hosted' => $this->selfHosted,
            'max_context_tokens' => $this->maxContextTokens,
            'model_size_bytes' => $this->modelSizeBytes,
            'warnings' => $this->warnings,
        ];
    }
}

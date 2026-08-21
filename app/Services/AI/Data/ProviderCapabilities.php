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
     *                               accepted at all. False where the driver drops
     *                               the parameter, so the panel does not present a
     *                               control attached to nothing.
     * @param bool $supportsReasoning whether the driver can *ask* for reasoning,
     *                                narrower than whether the model does any.
     *                                Only Anthropic has a request-side switch;
     *                                the other drivers read thinking off the
     *                                response and send nothing to cause it, so the
     *                                toggle would change nothing in either
     *                                direction.
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
        public readonly bool $supportsReasoning = false,
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

    /**
     * The wire shape the admin UI reads, and the only serialiser — add a field
     * here and in the `AiInferenceState` type in `adminAi.ts` and it arrives.
     * Hand-picking fields in the controller instead left this uncalled and four
     * capabilities write-only.
     *
     * `model` is excluded: it is what the caller asked *about* rather than
     * something the probe discovered, and the controller already knows it.
     */
    public function toArray(): array
    {
        return [
            'supports_tools' => $this->supportsTools,
            'supports_streaming' => $this->supportsStreaming,
            'supports_structured_output' => $this->supportsStructuredOutput,
            'supports_parallel_tool_calls' => $this->supportsParallelToolCalls,
            'supports_sampling' => $this->supportsSampling,
            'supports_reasoning' => $this->supportsReasoning,
            'self_hosted' => $this->selfHosted,
            'max_context_tokens' => $this->maxContextTokens,
            'model_size_bytes' => $this->modelSizeBytes,
            'warnings' => $this->warnings,
        ];
    }
}

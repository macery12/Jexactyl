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
     * @param bool $supportsReasoning whether the driver can *ask* for reasoning,
     *                                which is narrower than whether the model
     *                                does any. Only Anthropic has a request-side
     *                                switch (`thinking: adaptive`); the Ollama
     *                                and OpenAI-compatible drivers read thinking
     *                                off the response if it is there and send
     *                                nothing to cause it. On those, the panel's
     *                                reasoning toggle changes nothing in either
     *                                direction — turning it off does not stop a
     *                                reasoning model reasoning — and a control
     *                                that cannot do what its label says is worse
     *                                than an absent one.
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
     * The wire shape the admin UI reads.
     *
     * This is the only serialiser. `AiAgentController::inference()` used to
     * hand-pick fields into an array literal instead, which left this method
     * with no callers and four of the fields above write-only — set by every
     * driver, serialised by nothing, read by no one. Adding a capability then
     * meant editing five places and silently failing if you missed the
     * controller. Add a field here and in the `AiInferenceState` type in
     * `adminAi.ts`, and it arrives.
     *
     * `model` is not included: it is what the caller asked *about*, not
     * something the probe discovered, and the controller is where it is known.
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

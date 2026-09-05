import { SELF_HOSTED_PROVIDERS } from '@/api/adminAi';
import type { AiAdminSettings, AiInferenceState, AiProvider } from '@/api/adminAi';

// What the configured provider actually honours.
//
// Every one of these was previously an inline `isOllama &&` or `selfHosted &&`
// in the middle of the settings JSX, which is how three settings ended up being
// rendered for providers that ignore them. Deriving the whole set in one place
// means a control and the reason it is (or is not) shown stay together, and a
// new provider is one entry rather than a hunt through a thousand-line form.

export const DEFAULT_ENDPOINTS: Record<AiProvider, string> = {
    anthropic: 'https://api.anthropic.com/v1',
    openai: 'https://api.openai.com/v1',
    openrouter: 'https://openrouter.ai/api/v1',
    ollama: 'http://127.0.0.1:11434/v1',
    openai_compatible: '',
};

// Model names are proper nouns rendered verbatim (not catalogued), same as
// extension manifest copy. Shown only when live discovery has nothing.
const OPENAI_PRESETS = ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o4-mini'];
const ANTHROPIC_PRESETS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'];
// Tool-capable local models. A model without tool support cannot run the agent
// at all, so the suggestions here are deliberately limited to ones that report
// it — the capability probe is what actually decides.
//
// Ordered smallest-first, because these are only shown when live discovery
// found nothing, which usually means the endpoint is unreachable and the
// operator is setting up rather than choosing. The first entry runs on a laptop
// with no GPU; the last wants a 24 GB card. Reviewed 2026-08-15 — this list
// dates faster than anything else in the module, so check it against
// ollama.com/search?c=tools rather than trusting it.
const OLLAMA_PRESETS = [
    'granite4.1:3b',
    'granite4.1:8b',
    'gemma4:12b',
    'qwen3.6:27b',
    'qwen3.6:35b',
];

/**
 * How much of a temperature control is real.
 *
 * - `rejected` — the model refuses sampling parameters outright and the driver
 *   drops them. There is nothing to configure.
 * - `agent-pinned` — honoured for one-shot work (chat, crash analysis) but not
 *   for agent turns, which pin it to 0 so tool selection stays deterministic.
 * - `active` — honoured everywhere, which today means the agent is off.
 */
export type TemperatureState = 'rejected' | 'agent-pinned' | 'active';

export interface AiCapabilities {
    /** Whether the endpoint accepts a credential field at all. */
    apiKey: boolean;
    /** Whether that credential may be omitted (for example llama.cpp). */
    apiKeyOptional: boolean;
    /** Model residency. `keep_alive` is an Ollama request field. */
    keepAlive: boolean;
    /** `num_ctx`, which only the Ollama driver sends — an OpenAI-compatible
     *  shim in front of the same server silently discards it. */
    contextWindow: boolean;
    /** Slot-based admission control, for inference on hardware we own. */
    queue: boolean;
    /** Which of budget/queue is the binding constraint here: a hosted provider
     *  is bounded by spend, a self-hosted one by VRAM. */
    budgetIsPrimary: boolean;
    temperature: TemperatureState;
    /** Model suggestions, used only when live discovery returns nothing. */
    presets: string[];
    selfHosted: boolean;
    /** The probed agent model, for naming it in "rejected by …" copy. */
    probedModel: string | null;
    /**
     * An `openai_compatible` endpoint that is really Ollama behind its own
     * OpenAI shim. Worth naming, because the shim accepts the request and
     * discards `num_ctx` and `keep_alive` without complaint — so the panel looks
     * configured, the model answers, and the two settings that decide VRAM cost
     * and cold-start latency are quietly doing nothing. Selecting the `ollama`
     * driver instead is the whole fix.
     */
    shimmedOllama: boolean;
    /**
     * A local model whose context window is left to the model's own default,
     * where that default is very large.
     *
     * `num_ctx` is the most expensive knob on self-hosted hardware — a 256K
     * window costs more VRAM than the weights do — and the current generation of
     * tool-capable local models all report one. Left unset the panel asks for
     * the model's maximum and the operator finds out from the OOM.
     */
    unboundedContext: boolean;
    /** The window the probe reported, for naming a size in the copy above. */
    probedContextTokens: number | null;
    /**
     * Whether the reasoning toggle does anything.
     *
     * False does not mean "this model cannot reason" — it means this endpoint
     * cannot accept an explicit request from the panel. Some compatible servers
     * still reason according to their own launch or template configuration.
     */
    reasoning: boolean;
}

// A window past this is large enough that accepting the model's default is a
// decision rather than an oversight.
const LARGE_CONTEXT = 65_536;

// The port Ollama serves on. Matched on the port alone: operators reach it by
// hostname, container name and address alike, and all of them are the same
// mistake.
const OLLAMA_PORT = /:11434(\/|$)/;

export function resolveCapabilities(
    provider: AiProvider,
    settings: AiAdminSettings | undefined,
    inference: AiInferenceState | undefined,
): AiCapabilities {
    // One partition, shared with the module that already draws it, rather than
    // a second list here that could disagree with it.
    const hosted = !SELF_HOSTED_PROVIDERS.includes(provider);
    const isOllama = provider === 'ollama';

    // The probe answers for the model that is actually configured, so it is
    // only trustworthy while the form still agrees with what is saved. Mid-edit
    // the safe reading is "we do not know it is rejected", which keeps the
    // control visible rather than making it vanish as someone types.
    const probe = settings && inference?.capabilities?.model === settings.model ? inference.capabilities : null;

    return {
        // Local servers normally run without authentication, but both native
        // Ollama deployments behind a proxy and OpenAI-compatible servers may
        // require a Bearer token. The drivers already send one when configured.
        apiKey: true,
        apiKeyOptional: !hosted,
        keepAlive: isOllama,
        contextWindow: isOllama,
        queue: !hosted,
        budgetIsPrimary: hosted,
        temperature:
            probe?.supports_sampling === false
                ? 'rejected'
                : settings?.agent.enabled
                  ? 'agent-pinned'
                  : 'active',
        presets:
            provider === 'openai_compatible'
                ? []
                : provider === 'openrouter'
                  ? []
                  : provider === 'anthropic'
                    ? ANTHROPIC_PRESETS
                    : hosted
                      ? OPENAI_PRESETS
                      : OLLAMA_PRESETS,
        selfHosted: !hosted,
        probedModel: probe?.model ?? null,
        shimmedOllama: provider === 'openai_compatible' && OLLAMA_PORT.test(settings?.endpoint ?? ''),
        unboundedContext:
            isOllama
            && (settings?.context_tokens ?? null) === null
            && (probe?.max_context_tokens ?? 0) > LARGE_CONTEXT,
        probedContextTokens: probe?.max_context_tokens ?? null,
        // Unprobed reads as capable, for the same reason temperature does: mid-
        // edit, "we do not know it is inert" keeps the control visible rather
        // than making it vanish as someone types.
        reasoning: probe === null || probe.supports_reasoning,
    };
}

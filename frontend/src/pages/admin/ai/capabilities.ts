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
    ollama: 'http://127.0.0.1:11434',
    openai_compatible: '',
};

// Model names are proper nouns rendered verbatim (not catalogued), same as
// extension manifest copy. Shown only when live discovery has nothing.
const OPENAI_PRESETS = ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o', 'gpt-4o-mini', 'o4-mini'];
const ANTHROPIC_PRESETS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5'];
// Tool-capable local models. A model without tool support cannot run the agent
// at all, so the suggestions here are deliberately limited to ones that report
// it — the capability probe is what actually decides.
const OLLAMA_PRESETS = ['qwen3:30b-a3b', 'qwen3:8b', 'qwen2.5:7b', 'llama3.1:8b', 'mistral-nemo', 'llama3.3:70b'];

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
    /** Whether the endpoint authenticates at all. */
    apiKey: boolean;
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
}

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
        // An OpenAI-compatible endpoint is self-hosted but usually still wants
        // a key; a bare Ollama is the only one that authenticates nothing.
        apiKey: !isOllama,
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
        presets: provider === 'anthropic' ? ANTHROPIC_PRESETS : hosted ? OPENAI_PRESETS : OLLAMA_PRESETS,
        selfHosted: !hosted,
        probedModel: probe?.model ?? null,
    };
}

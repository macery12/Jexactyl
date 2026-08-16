import http from '@/lib/http';
import { streamAgentRequest, type AgentStreamCallbacks } from '@/lib/aiStream';

// Admin AI (M12Labs-AI) module — settings, health, model discovery, usage
// analytics and the admin assistant. Mirrors V1's `api/routes/admin/ai/*`
// against /api/application/ai/*.

export type AiProvider = 'anthropic' | 'openai' | 'openai_compatible' | 'ollama';

/** Providers the panel talks to over the network rather than paying per token. */
export const SELF_HOSTED_PROVIDERS: AiProvider[] = ['ollama', 'openai_compatible'];

export interface AiAgentSettings {
    enabled: boolean;
    /** The admin assistant, gated separately from the customer-facing agent. */
    admin_enabled: boolean;
    /** Ask the model to think before acting, where it can. */
    reasoning: boolean;
    max_steps: number;
    max_wall_seconds: number;
    /** Ceiling on one tool call — the bound the wall clock above cannot enforce. */
    max_tool_seconds: number;
    tool_result_bytes: number;
    max_repairs: number;
    max_tools: number;
    /** How many calls one approval may cover. */
    max_batch_calls: number;
    allow_destructive_batches: boolean;
}

export interface AiConcurrencySettings {
    slots: number | null;
    queue_depth: number;
    max_wait_seconds: number;
    per_user: number;
}

export interface AiBudgetSettings {
    enforce: boolean;
    monthly_tokens: number;
}

export type AiPiiCategory = 'email' | 'ip' | 'name' | 'phone' | 'address' | 'payment' | 'secret';

/** What is stripped out of tool results and attached context before a request leaves the panel. */
export interface AiPrivacySettings {
    enabled: boolean;
    categories: AiPiiCategory[];
    /** Every category the redactor knows, so the UI never hardcodes the list. */
    available: AiPiiCategory[];
}

export interface AiAdminSettings {
    enabled: boolean;
    // true when a key is stored (the key itself is never returned)
    key: boolean;
    endpoint: string;
    model: string;
    /** Legacy setting, still writable; `provider` is what actually resolves. */
    mode: 'openai' | 'ollama';
    provider: AiProvider;
    models: { agent: string; fast: string };
    max_tokens: number;
    temperature: number;
    context_tokens: number | null;
    keep_alive: string;
    warm: boolean;
    system_prompt: string;
    feature_server_assistant: boolean;
    feature_crash_analysis: boolean;
    agent: AiAgentSettings;
    concurrency: AiConcurrencySettings;
    budget: AiBudgetSettings;
    privacy: AiPrivacySettings;
}

export interface AiSettingsPayload {
    enabled?: boolean;
    key?: string;
    endpoint?: string;
    model?: string;
    mode?: 'openai' | 'ollama';
    provider?: AiProvider;
    models?: { agent?: string; fast?: string };
    max_tokens?: number;
    temperature?: number;
    context_tokens?: number | null;
    keep_alive?: string;
    warm?: boolean;
    system_prompt?: string;
    feature_server_assistant?: boolean;
    feature_crash_analysis?: boolean;
    agent?: Partial<AiAgentSettings>;
    concurrency?: Partial<AiConcurrencySettings>;
    budget?: Partial<AiBudgetSettings>;
    privacy?: { enabled?: boolean; categories?: AiPiiCategory[] };
}

export type AiRiskTier = 'safe' | 'write' | 'destructive';

export interface AiToolDefinition {
    name: string;
    description: string;
    scope: 'server' | 'admin';
    group: string | null;
    method: string;
    default_risk: AiRiskTier;
    risk: AiRiskTier;
    overridden: boolean;
    enabled: boolean;
    permissions: string[];
}

export interface AiToolCatalogue {
    data: AiToolDefinition[];
    groups: Record<string, string>;
    risks: AiRiskTier[];
    console: { defaults: string[]; extra: string[] };
}

export interface AiToolPolicyPayload {
    risk_overrides: Record<string, AiRiskTier>;
    disabled_tools: string[];
    console_safe_commands: string[];
}

export interface AiInferenceState {
    queue: {
        applies: boolean;
        slots: number;
        slots_in_use: number;
        queue_depth: number;
        [k: string]: unknown;
    };
    average_turn_ms: number;
    resident_models: { name?: string; model?: string; size_vram?: number; [k: string]: unknown }[];
    capabilities: {
        model: string;
        supports_tools: boolean;
        /**
         * False on models that reject `temperature` outright, where the driver
         * drops the parameter. Comes from the probe rather than a prefix list
         * duplicated here, which would drift from the driver's own.
         */
        supports_sampling: boolean;
        /**
         * Whether the driver can *ask* the model to reason, which is narrower
         * than whether the model does. Only Anthropic has a request-side switch;
         * elsewhere thinking is read off the response if it appears, so the
         * panel's reasoning toggle changes nothing in either direction.
         */
        supports_reasoning: boolean;
        self_hosted: boolean;
        max_context_tokens: number | null;
        /** Whole-response streaming. Every current driver does it. */
        supports_streaming: boolean;
        /** A JSON-schema-constrained response, used by the tool-call repair. */
        supports_structured_output: boolean;
        supports_parallel_tool_calls: boolean;
        /** On-disk size of a local model, where the endpoint reports one. */
        model_size_bytes: number | null;
        warnings: string[];
    } | null;
    error?: string;
}

export interface AiConnectionTest {
    status: 'ok' | 'error';
    latency_ms?: number;
    message?: string;
    from_cache?: boolean;
}

export interface AiModel {
    id: string;
    // bytes; only populated for Ollama installs
    size: number | null;
}

export interface AiStats {
    all_time: {
        total_requests: number;
        successful: number;
        errors: number;
        cache_hits: number;
        total_tokens: number;
        avg_latency_ms: number | null;
    };
    last_24h: { requests: number; tokens: number };
    last_7d: {
        requests: number;
        tokens: number;
        prompt_tokens: number;
        completion_tokens: number;
        cache_hits: number;
        errors: number;
    };
    /** Panel-wide, since the start of the month — the window a budget is measured in. */
    month_to_date_tokens: number;
    /**
     * Latency bucketed rather than averaged: an agent turn is many model calls
     * and a chat is one, so a mean over the two describes neither.
     */
    latency: {
        under_1s: number;
        to_5s: number;
        to_15s: number;
        to_60s: number;
        over_60s: number;
        slowest_ms: number | null;
        avg_ms: number | null;
    } | null;
    daily_series: { date: string; requests: number }[];
    top_users: { username: string; email: string | null; requests: number }[];
    /** Keyed by every source present in the window — client, agent, admin, admin-agent, modpack. */
    source_breakdown: Record<string, number>;
}

export interface AiLogEntry {
    id: number;
    created_at: string;
    username: string;
    server_name: string | null;
    model: string;
    source: 'client' | 'admin';
    status: 'success' | 'error';
    cached: boolean;
    total_tokens: number | null;
    latency_ms: number | null;
    error_message: string | null;
}

export interface AiLogsParams {
    limit?: number;
    source?: 'client' | 'agent' | 'admin' | 'admin-agent' | 'modpack' | '';
    status?: 'success' | 'error' | '';
    search?: string;
}

export async function getAiSettings(): Promise<AiAdminSettings> {
    const { data } = await http.get('/api/application/ai/settings');
    return data as AiAdminSettings;
}

export async function updateAiSettings(payload: AiSettingsPayload): Promise<void> {
    await http.put('/api/application/ai/settings', payload);
}

export async function testAiConnection(fresh = false): Promise<AiConnectionTest> {
    try {
        const { data } = await http.get('/api/application/ai/test', { params: fresh ? { fresh: 1 } : {} });
        return data as AiConnectionTest;
    } catch (err: unknown) {
        // A failing endpoint answers 502 with the same shape — surface it
        // instead of throwing so the status card can render the message.
        const resp = (err as { response?: { data?: AiConnectionTest } }).response;
        if (resp?.data?.status) return resp.data;
        throw err;
    }
}

export async function getAiModels(fresh = false): Promise<AiModel[]> {
    const { data } = await http.get('/api/application/ai/models', { params: fresh ? { fresh: 1 } : {} });
    return (data.data ?? []) as AiModel[];
}

export async function getAiStats(): Promise<AiStats> {
    const { data } = await http.get('/api/application/ai/stats');
    return data as AiStats;
}

export async function getAiLogs(params: AiLogsParams = {}): Promise<AiLogEntry[]> {
    const { data } = await http.get('/api/application/ai/logs', {
        params: {
            limit: params.limit ?? 10,
            ...(params.source ? { source: params.source } : {}),
            ...(params.status ? { status: params.status } : {}),
            ...(params.search ? { search: params.search } : {}),
        },
    });
    return data as AiLogEntry[];
}

export async function getAiTools(): Promise<AiToolCatalogue> {
    const { data } = await http.get('/api/application/ai/tools');
    return data as AiToolCatalogue;
}

export async function updateAiTools(payload: AiToolPolicyPayload): Promise<void> {
    await http.put('/api/application/ai/tools', payload);
}

export async function getAiInference(): Promise<AiInferenceState> {
    const { data } = await http.get('/api/application/ai/inference');
    return data as AiInferenceState;
}

/*
|--------------------------------------------------------------------------
| The admin assistant
|--------------------------------------------------------------------------
|
| Same event stream as the server assistant — `streamAgentRequest` takes a URL
| rather than an identifier, so nothing in the reader needed changing. What
| differs is only the endpoint and the absence of a server.
*/

export interface AdminAgentConversation {
    id: number;
    title: string;
    is_saved: boolean;
    expires_at: string | null;
    updated_at: string | null;
}

export interface AdminAgentMessage {
    role: 'user' | 'assistant' | 'tool' | 'system';
    content: string | null;
    tool_name: string | null;
    step: number | null;
}

/** An audited session this conversation has open on a customer's server. */
export interface AdminAssistSession {
    server_uuid: string;
    server_name: string;
    reason: string;
    abilities: string[];
    ticket_id: number | null;
    writable: boolean;
}

export interface AdminAgentTranscript {
    id: number;
    title: string;
    is_saved: boolean;
    /**
     * token => the value it stands for. The transcript holds tokens because the
     * model did; the map is what turns them back into something readable for the
     * administrator, who was never the one being kept from seeing them.
     */
    redactions: Record<string, string>;
    assist: AdminAssistSession | null;
    messages: AdminAgentMessage[];
}

export function streamAdminAgentTurn(
    opts: { query: string; conversationId?: number | null },
    callbacks: AgentStreamCallbacks,
    signal?: AbortSignal,
): void {
    streamAgentRequest(
        '/api/application/ai/agent',
        {
            query: opts.query,
            conversation_id: opts.conversationId ?? undefined,
        },
        callbacks,
        signal,
    );
}

export function streamAdminAgentDecision(
    opts: { turnId: string; decision: 'approve' | 'reject' | 'answer'; answer?: string },
    callbacks: AgentStreamCallbacks,
    signal?: AbortSignal,
): void {
    streamAgentRequest(
        '/api/application/ai/agent/decide',
        {
            turn_id: opts.turnId,
            decision: opts.decision,
            answer: opts.answer ?? undefined,
        },
        callbacks,
        signal,
    );
}

export async function listAdminAgentConversations(): Promise<AdminAgentConversation[]> {
    const { data } = await http.get('/api/application/ai/agent/conversations');
    return data.data as AdminAgentConversation[];
}

export async function getAdminAgentConversation(id: number): Promise<AdminAgentTranscript> {
    const { data } = await http.get(`/api/application/ai/agent/conversations/${id}`);
    return data.data as AdminAgentTranscript;
}

/**
 * End the assist session a conversation has open on a customer's server.
 *
 * The capability behind it is re-checked on every turn regardless, so this is
 * not what makes the access stop — it is what lets an administrator who has
 * finished say so, and see it stop.
 */
export async function endAdminAssist(conversationId: number): Promise<void> {
    await http.delete(`/api/application/ai/agent/conversations/${conversationId}/assist`);
}

export async function toggleAdminAgentConversationSave(id: number): Promise<void> {
    await http.patch(`/api/application/ai/agent/conversations/${id}/save`);
}

export async function deleteAdminAgentConversation(id: number): Promise<void> {
    await http.delete(`/api/application/ai/agent/conversations/${id}`);
}

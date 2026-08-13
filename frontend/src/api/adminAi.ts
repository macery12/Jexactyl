import http from '@/lib/http';
import { streamAiRequest, type AiStreamCallbacks } from '@/lib/aiStream';

// Admin AI (M12Labs-AI) module — settings, health, model discovery, usage
// analytics and the admin chat playground. Mirrors V1's
// `api/routes/admin/ai/*` against /api/application/ai/*.

export type AiProvider = 'anthropic' | 'openai' | 'openai_compatible' | 'ollama';

/** Providers the panel talks to over the network rather than paying per token. */
export const SELF_HOSTED_PROVIDERS: AiProvider[] = ['ollama', 'openai_compatible'];

export interface AiAgentSettings {
    enabled: boolean;
    max_steps: number;
    max_wall_seconds: number;
    tool_result_bytes: number;
    max_repairs: number;
    max_tools: number;
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
        self_hosted: boolean;
        max_context_tokens: number | null;
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
    last_7d: { requests: number; tokens: number; cache_hits: number };
    daily_series: { date: string; requests: number }[];
    top_users: { username: string; email: string | null; requests: number }[];
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
    source?: 'client' | 'admin' | '';
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

export function streamAdminAiQuery(query: string, callbacks: AiStreamCallbacks, signal?: AbortSignal): void {
    streamAiRequest('/api/application/ai/query', { query }, callbacks, signal);
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

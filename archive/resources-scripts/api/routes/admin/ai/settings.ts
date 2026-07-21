import http from '@/api/http';

/**
 * The full AI settings returned by the admin API.
 * `key` is a boolean indicating whether a key is currently set (never exposed as a string).
 */
export interface AIAdminSettings {
    key?: boolean;
    enabled?: boolean;
    endpoint?: string;
    model?: string;
    mode?: string;
    max_tokens?: number;
    temperature?: number;
    system_prompt?: string;
    feature_server_assistant?: boolean;
    feature_crash_analysis?: boolean;
}

/**
 * The settings payload sent when saving. `key` here is a plain string (new value or empty to delete).
 */
export interface AISettings {
    key?: string;
    enabled?: boolean;
    endpoint?: string;
    model?: string;
    mode?: string;
    max_tokens?: number;
    temperature?: number;
    system_prompt?: string;
    feature_server_assistant?: boolean;
    feature_crash_analysis?: boolean;
}

export const fetchSettings = (): Promise<AIAdminSettings> => {
    return new Promise((resolve, reject) => {
        http.get('/api/application/ai/settings')
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export const updateSettings = (settings: AISettings): Promise<void> => {
    return new Promise((resolve, reject) => {
        http.put('/api/application/ai/settings', settings)
            .then(() => resolve())
            .catch(reject);
    });
};

export interface ConnectionTestResult {
    status: 'ok' | 'error';
    latency_ms?: number;
    message?: string;
}

export const testConnection = (): Promise<ConnectionTestResult> => {
    return http.get('/api/application/ai/test').then(({ data }) => data);
};

export interface DailyStat {
    date: string;
    requests: number;
}
export interface TopUser {
    username: string;
    email: string | null;
    requests: number;
}

export interface AIStats {
    all_time: {
        total_requests: number;
        successful: number;
        errors: number;
        total_tokens: number;
        avg_latency_ms: number | null;
    };
    last_24h: { requests: number; tokens: number };
    last_7d: { requests: number; tokens: number };
    daily_series: DailyStat[];
    top_users: TopUser[];
    source_breakdown: Record<string, number>;
}

export const getStats = (): Promise<AIStats> => {
    return http.get('/api/application/ai/stats').then(({ data }) => data);
};

export interface AILogEntry {
    id: number;
    created_at: string;
    username: string;
    server_name: string | null;
    model: string;
    source: 'client' | 'admin';
    status: 'success' | 'error';
    total_tokens: number | null;
    latency_ms: number | null;
    error_message: string | null;
}

export const getRecentLogs = (): Promise<AILogEntry[]> => {
    return http.get('/api/application/ai/logs', { params: { limit: 10 } }).then(({ data }) => data);
};

export interface GetLogsParams {
    limit?: number;
    source?: 'client' | 'admin' | '';
    status?: 'success' | 'error' | '';
    search?: string;
}

export const getLogs = (params: GetLogsParams = {}): Promise<AILogEntry[]> => {
    const p: Record<string, string | number> = { limit: params.limit ?? 500 };
    if (params.source) p.source = params.source;
    if (params.status) p.status = params.status;
    if (params.search) p.search = params.search;
    return http.get('/api/application/ai/logs', { params: p }).then(({ data }) => data);
};

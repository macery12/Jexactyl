import http from '@/lib/http';

// Admin email management client. Mirrors V1's api/routes/admin/email contract
// (the `/api/application/email/*` endpoints already exist server-side — this is
// a frontend-only port). These endpoints return plain JSON, not Fractal
// collections, so payloads stay snake_case.

export type EmailTransport = 'resend' | 'smtp';
export type EmailStatus = 'queued' | 'sending' | 'sent' | 'deferred' | 'skipped' | 'failed';
export type EmailTestType = 'connection' | 'delivery';
export type ResendPlanKey = 'free' | 'pro' | 'scale' | 'enterprise';

export interface ResendPlanDefinition {
    key: ResendPlanKey;
    name: string;
    daily_limit: number | null;
    monthly_limit: number | null;
    enforce_daily: boolean;
    enforce_monthly: boolean;
    allows_custom_limits: boolean;
    custom_daily_limit?: number | null;
    custom_monthly_limit?: number | null;
}

export interface ResendSettings {
    api_key: boolean; // true if a key is stored
    from_email: string;
    from_name: string;
    reply_to: string;
    domain?: string;
}

export interface ResendQuotaUsage {
    daily_sent: number;
    monthly_sent: number;
    daily_limit: number | null;
    monthly_limit: number | null;
    daily_remaining: number | null;
    monthly_remaining: number | null;
    next_daily_reset: string | null;
    next_monthly_reset: string | null;
    source?: 'provider' | 'internal';
    synced_at?: string | null;
}

export interface ResendRateLimitMeta {
    limit: string | null;
    remaining: string | null;
    reset: string | null;
    retry_after: string | null;
    updated_at?: string | null;
}

export interface SmtpSettings {
    host: string;
    port: string;
    username: string;
    password_set: boolean;
    encryption: string;
    from_email: string;
    from_name: string;
    reply_to: string;
}

export interface EmailSettings {
    enabled: boolean;
    transport: EmailTransport;
    resend: ResendSettings;
    smtp: SmtpSettings;
    resend_plan: ResendPlanDefinition;
    resend_plans: ResendPlanDefinition[];
    resend_usage: ResendQuotaUsage;
    resend_rate_limit: ResendRateLimitMeta | null;
}

export interface EmailSettingsUpdate {
    enabled?: boolean;
    transport?: EmailTransport;
    api_key?: string;
    clear_api_key?: boolean;
    from_email?: string;
    from_name?: string;
    reply_to?: string;
    smtp_host?: string;
    smtp_port?: string;
    smtp_username?: string;
    smtp_password?: string;
    clear_smtp_password?: boolean;
    smtp_encryption?: string;
    smtp_from_email?: string;
    smtp_from_name?: string;
    smtp_reply_to?: string;
    resend_plan?: ResendPlanKey;
    resend_custom_monthly_limit?: number | null;
    resend_custom_daily_limit?: number | null;
}

export interface EmailError {
    code: string;
    status: number;
    message: string;
}

export interface EmailResponse {
    success: boolean;
    action?: 'connection_test' | 'send_test';
    message_id?: string;
    transport?: EmailTransport;
    provider?: EmailTransport;
    sent_at?: string;
    tested_at?: string;
    recipient?: string;
    status?: EmailStatus;
    test_type?: EmailTestType;
    reason?: string;
    error?: EmailError | string;
}

export const getEmailSettings = (): Promise<EmailSettings> =>
    http.get<EmailSettings>('/api/application/email/settings').then(r => r.data);

export const updateEmailSettings = (settings: EmailSettingsUpdate): Promise<EmailSettings> =>
    http.put<EmailSettings>('/api/application/email/settings', settings).then(r => r.data);

export const testSmtpConnection = (): Promise<EmailResponse> =>
    http.post<EmailResponse>('/api/application/email/test-smtp').then(r => r.data);

export const testResendConnection = (): Promise<EmailResponse> =>
    http.post<EmailResponse>('/api/application/email/test-resend').then(r => r.data);

export const sendTestEmail = (to: string): Promise<EmailResponse> =>
    http.post<EmailResponse>('/api/application/email/test', { to }).then(r => r.data);

// --- Notifications ---------------------------------------------------------

export interface EmailNotificationSetting {
    id: number;
    template_key: string;
    enabled: boolean;
    category: string;
    name: string;
    description: string | null;
    rate_limit_exempt: boolean;
}

export interface NotificationSettingsResponse {
    categories: Record<string, EmailNotificationSetting[]>;
}

export const getNotificationSettings = (): Promise<NotificationSettingsResponse> =>
    http.get<NotificationSettingsResponse>('/api/application/email/notifications').then(r => r.data);

export const updateNotificationSetting = (
    id: number,
    enabled: boolean,
): Promise<{ success: boolean; setting: EmailNotificationSetting }> =>
    http
        .put<{ success: boolean; setting: EmailNotificationSetting }>(
            `/api/application/email/notifications/${id}`,
            { enabled },
        )
        .then(r => r.data);

// --- Activity log ----------------------------------------------------------

export interface EmailLog {
    id: number;
    to: string;
    subject: string;
    template_key: string | null;
    correlation_id: string | null;
    message_id: string | null;
    provider: string;
    user_id: number | null;
    success: boolean;
    status: EmailStatus;
    attempt_count: number;
    duration_ms: number | null;
    error: string | null;
    tags: Record<string, unknown> | null;
    metadata: Record<string, unknown> | null;
    created_at: string;
    updated_at: string;
    user?: { id: number; email: string; username: string };
}

export interface EmailLogDetail {
    log: EmailLog;
    sanitized_variables: Record<string, unknown>;
    retry_history: Array<{
        attempt: number;
        timestamp: string;
        status: EmailStatus;
        duration_ms?: number | null;
        error?: string;
    }>;
    related_emails: Array<{
        id: number;
        to: string;
        subject: string;
        template_key: string | null;
        status: EmailStatus;
        created_at: string;
    }>;
}

export interface EmailLogFilters {
    status?: string;
    template_key?: string;
    recipient?: string;
    only_failures?: boolean;
    date_from?: string;
    date_to?: string;
    per_page?: number;
    page?: number;
}

export interface PaginatedResponse<T> {
    data: T[];
    current_page: number;
    last_page: number;
    per_page: number;
    total: number;
}

export const getEmailLogs = (filters?: EmailLogFilters): Promise<PaginatedResponse<EmailLog>> =>
    http.get<PaginatedResponse<EmailLog>>('/api/application/email/logs', { params: filters }).then(r => r.data);

export const getEmailLog = (id: number): Promise<EmailLogDetail> =>
    http.get<EmailLogDetail>(`/api/application/email/logs/${id}`).then(r => r.data);

export const getTemplateKeys = (): Promise<{ template_keys: string[] }> =>
    http.get<{ template_keys: string[] }>('/api/application/email/logs/templates').then(r => r.data);

// --- Deferred queue --------------------------------------------------------

export interface DeferredEmail {
    id: number;
    user_id: number;
    template_key: string;
    recipient: string;
    data: Record<string, unknown>;
    correlation_id: string | null;
    reason: string;
    scheduled_at: string;
    sent_at: string | null;
    attempts: number;
    created_at: string;
    updated_at: string;
    user?: { id: number; email: string; username: string };
}

export interface DeferredQueueResponse {
    deferred: PaginatedResponse<DeferredEmail>;
    stats: {
        total_queued: number;
        due_now: number;
        next_send_time: string | null;
    };
}

export const getDeferredQueue = (filters?: {
    status?: 'due' | 'pending';
    per_page?: number;
    page?: number;
}): Promise<DeferredQueueResponse> =>
    http.get<DeferredQueueResponse>('/api/application/email/deferred', { params: filters }).then(r => r.data);

export const sendDeferredNow = (id: number): Promise<{ success: boolean; message: string; error?: string }> =>
    http
        .post<{ success: boolean; message: string; error?: string }>(
            `/api/application/email/deferred/${id}/send-now`,
        )
        .then(r => r.data);

export const cancelDeferred = (id: number): Promise<{ success: boolean; message: string }> =>
    http.delete<{ success: boolean; message: string }>(`/api/application/email/deferred/${id}`).then(r => r.data);

// --- Templates -------------------------------------------------------------

// A single documented variable that a template can interpolate. Rendered in the
// editor's reference panel and click-to-insert list.
export interface EmailTemplateVariable {
    name: string;
    description: string;
    example: string | number | boolean;
    required: boolean;
}

// Summary entry returned by the template index — enough to render a card and
// open the editor. Full Twig source is fetched lazily per template.
export interface EmailTemplateSummary {
    key: string;
    label: string;
    category: string;
    variables: EmailTemplateVariable[];
    is_customized: boolean;
}

export interface EmailTemplateSource {
    key: string;
    content: string;
    is_customized: boolean;
}

export const getEmailTemplates = (): Promise<{ templates: EmailTemplateSummary[] }> =>
    http.get<{ templates: EmailTemplateSummary[] }>('/api/application/email/templates').then(r => r.data);

export const getEmailTemplateSource = (key: string): Promise<EmailTemplateSource> =>
    http.get<EmailTemplateSource>(`/api/application/email/templates/${key}/source`).then(r => r.data);

export const saveEmailTemplateSource = (
    key: string,
    content: string,
): Promise<{ success: boolean; key: string; is_customized: boolean }> =>
    http
        .put<{ success: boolean; key: string; is_customized: boolean }>(
            `/api/application/email/templates/${key}/source`,
            { content },
        )
        .then(r => r.data);

export const revertEmailTemplate = (
    key: string,
): Promise<{ success: boolean; key: string; is_customized: boolean }> =>
    http
        .delete<{ success: boolean; key: string; is_customized: boolean }>(
            `/api/application/email/templates/${key}/source`,
        )
        .then(r => r.data);

// Render the currently-saved template (custom override if one exists, else the
// default) to HTML with sample data. The preview reflects saved state — the
// editor refreshes it after a save, mirroring the V1 flow.
export const getEmailTemplatePreview = (key: string): Promise<string> =>
    http
        .get<string>(`/api/application/email/templates/${key}/preview`, {
            responseType: 'text',
            transformResponse: r => r,
        })
        .then(r => r.data);

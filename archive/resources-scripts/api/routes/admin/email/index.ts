import http from '@/api/http';
import { type VerificationRules } from '@/state/everest';

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
    api_key: boolean; // true if key exists, false otherwise
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

export interface SendTestEmailRequest {
    to: string;
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

export const getSettings = (): Promise<EmailSettings> => {
    return new Promise((resolve, reject) => {
        http.get<EmailSettings>(`/api/application/email/settings`)
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export const updateSettings = (settings: EmailSettingsUpdate): Promise<EmailSettings> => {
    return new Promise((resolve, reject) => {
        http.put<EmailSettings>(`/api/application/email/settings`, settings)
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export const getVerificationRules = (): Promise<VerificationRules> => {
    return new Promise((resolve, reject) => {
        http.get<VerificationRules>(`/api/application/email/verification-rules`)
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export const updateVerificationRules = (rules: VerificationRules): Promise<VerificationRules> => {
    return new Promise((resolve, reject) => {
        http.put<VerificationRules>(`/api/application/email/verification-rules`, rules)
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export const testSmtpConnection = (): Promise<EmailResponse> => {
    return new Promise((resolve, reject) => {
        http.post<EmailResponse>(`/api/application/email/test-smtp`)
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export const testResendConnection = (): Promise<EmailResponse> => {
    return new Promise((resolve, reject) => {
        http.post<EmailResponse>(`/api/application/email/test-resend`)
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export const sendTestEmail = (data: SendTestEmailRequest): Promise<EmailResponse> => {
    return new Promise((resolve, reject) => {
        http.post<EmailResponse>(`/api/application/email/test`, data)
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

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

export const getNotificationSettings = (): Promise<NotificationSettingsResponse> => {
    return new Promise((resolve, reject) => {
        http.get<NotificationSettingsResponse>(`/api/application/email/notifications`)
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export const updateNotificationSetting = (
    id: number,
    enabled: boolean,
): Promise<{ success: boolean; setting: EmailNotificationSetting }> => {
    return new Promise((resolve, reject) => {
        http.put<{ success: boolean; setting: EmailNotificationSetting }>(
            `/api/application/email/notifications/${id}`,
            { enabled },
        )
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

// Email Activity Log types and APIs
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
    tags: Record<string, any> | null;
    metadata: Record<string, any> | null;
    created_at: string;
    updated_at: string;
    user?: {
        id: number;
        email: string;
        username: string;
    };
}

export interface EmailLogDetail {
    log: EmailLog;
    sanitized_variables: Record<string, any>;
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
    status?: EmailStatus;
    template_key?: string;
    recipient?: string;
    user_id?: number;
    only_failures?: boolean;
    date_from?: string;
    date_to?: string;
    sort_by?: string;
    sort_dir?: 'asc' | 'desc';
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

export interface DeferredEmail {
    id: number;
    user_id: number;
    template_key: string;
    recipient: string;
    data: Record<string, any>;
    correlation_id: string | null;
    reason: string;
    scheduled_at: string;
    sent_at: string | null;
    attempts: number;
    created_at: string;
    updated_at: string;
    user?: {
        id: number;
        email: string;
        username: string;
    };
}

export interface DeferredQueueResponse {
    deferred: PaginatedResponse<DeferredEmail>;
    stats: {
        total_queued: number;
        due_now: number;
        next_send_time: string | null;
    };
}

export const getEmailLogs = (filters?: EmailLogFilters): Promise<PaginatedResponse<EmailLog>> => {
    return new Promise((resolve, reject) => {
        http.get<PaginatedResponse<EmailLog>>(`/api/application/email/logs`, { params: filters })
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export const getEmailLog = (id: number): Promise<EmailLogDetail> => {
    return new Promise((resolve, reject) => {
        http.get<EmailLogDetail>(`/api/application/email/logs/${id}`)
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export const getTemplateKeys = (): Promise<{ template_keys: string[] }> => {
    return new Promise((resolve, reject) => {
        http.get<{ template_keys: string[] }>(`/api/application/email/logs/templates`)
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export const getDeferredQueue = (filters?: {
    status?: 'due' | 'pending';
    per_page?: number;
    page?: number;
}): Promise<DeferredQueueResponse> => {
    return new Promise((resolve, reject) => {
        http.get<DeferredQueueResponse>(`/api/application/email/deferred`, { params: filters })
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export const sendDeferredNow = (id: number): Promise<{ success: boolean; message: string; error?: string }> => {
    return new Promise((resolve, reject) => {
        http.post<{ success: boolean; message: string; error?: string }>(
            `/api/application/email/deferred/${id}/send-now`,
        )
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export const cancelDeferred = (id: number): Promise<{ success: boolean; message: string }> => {
    return new Promise((resolve, reject) => {
        http.delete<{ success: boolean; message: string }>(`/api/application/email/deferred/${id}`)
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

// Email template viewer/editor
export interface TemplateVariable {
    name: string;
    description: string;
    example: string;
    required: boolean;
}

export interface EmailTemplate {
    key: string;
    label: string;
    category: string;
    variables: TemplateVariable[];
    is_customized: boolean;
}

export const getEmailTemplates = (): Promise<{ templates: EmailTemplate[] }> => {
    return new Promise((resolve, reject) => {
        http.get<{ templates: EmailTemplate[] }>(`/api/application/email/templates`)
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export const previewEmailTemplate = (key: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        http.get<string>(`/api/application/email/templates/${encodeURIComponent(key)}/preview`, {
            responseType: 'text',
            transformResponse: [data => data],
        })
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export const getEmailTemplateSource = (
    key: string,
): Promise<{ key: string; content: string; is_customized: boolean }> => {
    return new Promise((resolve, reject) => {
        http.get<{ key: string; content: string; is_customized: boolean }>(
            `/api/application/email/templates/${encodeURIComponent(key)}/source`,
        )
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export const saveEmailTemplateSource = (
    key: string,
    content: string,
): Promise<{ success: boolean; key: string; is_customized: boolean }> => {
    return new Promise((resolve, reject) => {
        http.put<{ success: boolean; key: string; is_customized: boolean }>(
            `/api/application/email/templates/${encodeURIComponent(key)}/source`,
            { content },
        )
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export const revertEmailTemplate = (
    key: string,
): Promise<{ success: boolean; key: string; is_customized: boolean }> => {
    return new Promise((resolve, reject) => {
        http.delete<{ success: boolean; key: string; is_customized: boolean }>(
            `/api/application/email/templates/${encodeURIComponent(key)}/source`,
        )
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

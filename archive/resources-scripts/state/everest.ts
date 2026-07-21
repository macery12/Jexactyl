import { action, Action } from 'easy-peasy';

export type AlertType = 'success' | 'warning' | 'danger' | 'info';
export type AlertPosition = 'notification' | 'top-center' | 'slide-out' | 'center' | 'bottom-right' | 'bottom-left';

export type VerificationArea = 'billing' | 'orders' | 'credentials' | 'tickets';
export type VerificationRule = { can_view: boolean; can_interact: boolean };
export type VerificationRules = Record<VerificationArea, VerificationRule>;

export interface EverestSettings {
    auth: {
        registration: {
            enabled: boolean;
        };
        security: {
            force2fa: boolean;
        };
        modules: {
            jguard: {
                enabled: boolean;
                approval_mode: 'manual' | 'delayed' | 'immediate';
                delay: number;
                pending_message: string;
            };
            discord: {
                enabled: boolean;
                clientId: boolean;
                clientSecret: boolean;
            };
            google: {
                enabled: boolean;
                clientId: boolean;
                clientSecret: boolean;
            };
            onboarding: {
                enabled: boolean;
                content?: string;
            };
        };
        captcha: {
            provider?: string;
            site_key?: string;
        };
    };
    tickets: {
        enabled: boolean;
        maxCount: number;
    };
    billing: {
        enabled: boolean;
        processors?: {
            stripe: {
                available: boolean;
                enabled: boolean;
            };
            paypal: {
                available: boolean;
                enabled: boolean;
            };
        };
        // Admin-only fields (conditionally present)
        keys?: {
            publishable?: boolean;
            secret?: boolean;
        };
        paypal_standalone?: {
            mode?: string;
        };
        integrations?: {
            [key: string]: {
                enabled: boolean;
            };
        };
        currency: {
            symbol: string;
            code: string;
        };
        links: {
            terms: string;
            privacy: string;
        };
        require_billing_address?: boolean;
        renewal?: {
            days?: number;
            free_renewal_days?: number;
            suspension_threshold?: number;
            suspension_threshold_percentage?: number;
            min_suspension_threshold_days?: number;
            max_suspension_threshold_days?: number;
            free_suspension_days?: number;
            paid_suspension_days?: number;
            default_billing_days?: number;
            multiplier_steps?: string;
        };
        plan_change_cooldown_hours?: number;
    };
    ai: {
        enabled: boolean;
        feature_server_assistant: boolean;
        feature_crash_analysis: boolean;
    };
    mods: {
        enabled: boolean;
        default_source?: string;
        spiget_enabled?: boolean;
        allow_external_downloads?: boolean;
        curseforge_cdn_fallback?: boolean;
        curseforge?: {
            enabled: boolean;
            configured: boolean;
        };
        download?: {
            max_concurrent_per_server?: number;
            max_per_minute_per_user?: number;
            max_queue_size_per_server?: number;
            max_mod_size_mb?: number;
            max_plugin_size_mb?: number;
        };
    };
    webhooks: {
        enabled: boolean;
        url: boolean;
    };
    email: {
        enabled?: boolean;
        resend:
            | {
                  enabled?: boolean;
                  api_key: boolean;
                  from_email: string;
                  from_name: string;
                  reply_to: string;
              }
            | boolean;
        verification_rules?: VerificationRules;
    };
    extensions: {
        enabled: boolean;
    };
    custom_domains: {
        enabled: boolean;
    };
}

export interface EverestStore {
    data?: EverestSettings;
    setEverest: Action<EverestStore, EverestSettings>;
    updateEverest: Action<EverestStore, Partial<EverestSettings>>;
}

const everest: EverestStore = {
    data: undefined,

    setEverest: action((state, payload) => {
        state.data = payload;
    }),

    updateEverest: action((state, payload) => {
        // @ts-expect-error limitation of Typescript, can't do much about that currently unfortunately.
        state.data = { ...state.data, ...payload };
    }),
};

export default everest;

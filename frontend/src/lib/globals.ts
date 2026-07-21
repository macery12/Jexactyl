// Types for the window.* globals injected by the Laravel blade (see V1
// wrapper.blade.php + the *-bound view composers). These are the bootstrap
// contract the v2 UI reads — identical to what V1 consumes.

export interface PterodactylUser {
    uuid: string;
    username: string;
    email: string;
    root_admin: boolean;
    use_totp: boolean;
    // null = no preference; the panel-wide default locale applies.
    language: string | null;
    avatar_url: string;
    admin_role_name: string;
    admin_role_id?: number;
    state: string;
    email_verified?: boolean;
    email_verified_at?: string | null;
    updated_at: string;
    created_at: string;
    discord_linked?: boolean;
}

export interface SiteConfiguration {
    name: string;
    logo: string | null;
    mode: string;
    setup: boolean;
    debug: boolean;
    locale: string;
    // Admin toggle (app:user_locale): may users override the panel language?
    user_locale: boolean;
    speed_dial: boolean;
    indicators: boolean;
    captcha: { enabled: boolean; siteKey: string };
    activity: { enabled: { account: boolean; server: boolean; admin: boolean } };
}

export interface ThemeConfiguration {
    colors: {
        primary?: string | null;
        canvas?: string | null;
        surface?: string | null;
        surface_2?: string | null;
        border?: string | null;
        ink?: string | null;
        ink_muted?: string | null;
        accent?: string | null;
        warning?: string | null;
        danger?: string | null;
    };
    feel?: {
        radius?: 'sharp' | 'soft' | 'round' | null;
        grid_enabled?: boolean | null;
        grid_opacity?: number | null;
        grid_size?: number | null;
        aurora_enabled?: boolean | null;
        aurora_intensity?: number | null;
    };
}

// Storefront/checkout billing config surfaced through the everest payload
// (mirrors V1's state/everest.ts `billing` block). Only the client-facing
// fields the V2 store/checkout reads are typed here.
export interface BillingConfig {
    enabled: boolean;
    processors?: {
        stripe: { available: boolean; enabled: boolean };
        paypal: { available: boolean; enabled: boolean };
    };
    currency: { symbol: string; code: string };
    links: { terms: string; privacy: string };
    require_billing_address?: boolean;
    [k: string]: unknown;
}

// Feature flags — kept loose; only the fields the registry conditions read are
// strongly used. Mirrors window.EverestConfiguration.
export interface EverestConfiguration {
    auth: {
        registration: { enabled: boolean };
        security: { force2fa: boolean; attempts?: number };
        captcha: { provider: string; site_key: string };
        modules: {
            discord: { enabled: boolean; clientId?: boolean; clientSecret?: boolean };
            google: { enabled: boolean; clientId?: boolean; clientSecret?: boolean };
            onboarding: { enabled: boolean; content?: string };
            jguard: {
                enabled: boolean;
                approval_mode?: 'manual' | 'delayed' | 'immediate';
                delay?: number;
                pending_message?: string;
            };
            [k: string]: unknown;
        };
    };
    tickets: { enabled: boolean; maxCount: number };
    billing: BillingConfig;
    ai: { enabled: boolean; feature_server_assistant: boolean; [k: string]: unknown };
    mods: { enabled: boolean; [k: string]: unknown };
    webhooks: { enabled: boolean; [k: string]: unknown };
    // `enabled` = mail delivery is configured; `module_enabled` = admin has
    // surfaced the Email admin module (the feature toggle drives the latter).
    email: { enabled: boolean; module_enabled?: boolean; [k: string]: unknown };
    // `active` (enabled extension ids) is only present in admin sessions; it
    // gates extension-contributed admin nav entries.
    extensions: { enabled: boolean; active?: string[] };
    custom_domains: { enabled: boolean };
    [k: string]: unknown;
}

// Public landing page configuration — injected by LandingComposer for every
// view (including logged-out visitors) so the landing page renders instantly
// with no extra request. The rich section structure is admin-editable.
export type LandingSectionId = 'hero' | 'features' | 'pricing' | 'faq' | 'testimonials' | 'custom';

export interface LandingCta {
    label: string;
    href: string;
}

export interface LandingFeatureItem {
    icon: string;
    title: string;
    body: string;
}

export interface LandingFaqItem {
    q: string;
    a: string;
}

export interface LandingTestimonialItem {
    quote: string;
    author: string;
    role: string;
}

// Per-section data is loosely typed (shape varies by section id); the section
// components and admin editor read the fields they own. Blank string fields are
// treated as "use the translated Paraglide default".
export interface LandingSectionData {
    badge?: string;
    title?: string;
    subtitle?: string;
    heading?: string;
    backgroundImage?: string;
    primaryCta?: LandingCta;
    secondaryCta?: LandingCta;
    items?: Array<LandingFeatureItem | LandingFaqItem | LandingTestimonialItem>;
    categoryIds?: number[];
    body?: string;
}

export interface LandingSection {
    id: LandingSectionId;
    enabled: boolean;
    order: number;
    data: LandingSectionData;
}

export interface LandingConfiguration {
    enabled: boolean;
    sections: LandingSection[];
}

export interface FlashMessage {
    type: 'success' | 'error' | 'info' | 'warning';
    message: string;
}

declare global {
    interface Window {
        PterodactylUser?: PterodactylUser;
        SiteConfiguration?: SiteConfiguration;
        ThemeConfiguration?: ThemeConfiguration;
        EverestConfiguration?: EverestConfiguration;
        LandingConfiguration?: LandingConfiguration;
        FlashMessages?: FlashMessage[];
    }
}

export const readCsrfToken = (): string =>
    document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '';

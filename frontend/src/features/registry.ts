import type { LucideIcon } from 'lucide-react';
import { Globe, Bot, Boxes, Mail, Webhook, Puzzle, LifeBuoy, CreditCard } from 'lucide-react';
import type { EverestConfiguration } from '@/lib/globals';

// Single source of truth for the toggleable optional modules surfaced on the
// admin Features page. Mirrors the server-side FeaturesController::FEATURES map.
// Billing is included so it round-trips through the same API, but the page
// renders it on its own (a "disable billing completely" master switch).
export type FeatureKey =
    | 'custom_domains'
    | 'ai'
    | 'mods'
    | 'email'
    | 'webhooks'
    | 'extensions'
    | 'tickets'
    | 'billing';

export type FeatureFlags = Record<FeatureKey, boolean>;

export interface FeatureDef {
    key: FeatureKey;
    icon: LucideIcon;
    /** i18n ids (admin.features.items.<key>.*). */
    labelKey: string;
    descKey: string;
    /** Read the effective on/off state from the bootstrap flags. */
    read: (f: EverestConfiguration) => boolean;
}

// Optional modules shown in the toggle grid (billing is rendered separately).
export const MODULE_FEATURES: FeatureDef[] = [
    {
        key: 'custom_domains',
        icon: Globe,
        labelKey: 'admin.features.items.custom_domains.label',
        descKey: 'admin.features.items.custom_domains.desc',
        read: f => !!f.custom_domains?.enabled,
    },
    {
        key: 'ai',
        icon: Bot,
        labelKey: 'admin.features.items.ai.label',
        descKey: 'admin.features.items.ai.desc',
        read: f => !!f.ai?.enabled,
    },
    {
        key: 'mods',
        icon: Boxes,
        labelKey: 'admin.features.items.mods.label',
        descKey: 'admin.features.items.mods.desc',
        read: f => !!f.mods?.enabled,
    },
    {
        key: 'email',
        icon: Mail,
        labelKey: 'admin.features.items.email.label',
        descKey: 'admin.features.items.email.desc',
        read: f => !!f.email?.module_enabled,
    },
    {
        key: 'webhooks',
        icon: Webhook,
        labelKey: 'admin.features.items.webhooks.label',
        descKey: 'admin.features.items.webhooks.desc',
        read: f => !!f.webhooks?.enabled,
    },
    {
        key: 'extensions',
        icon: Puzzle,
        labelKey: 'admin.features.items.extensions.label',
        descKey: 'admin.features.items.extensions.desc',
        read: f => !!f.extensions?.enabled,
    },
    {
        key: 'tickets',
        icon: LifeBuoy,
        labelKey: 'admin.features.items.tickets.label',
        descKey: 'admin.features.items.tickets.desc',
        read: f => !!f.tickets?.enabled,
    },
];

export const BILLING_FEATURE: FeatureDef = {
    key: 'billing',
    icon: CreditCard,
    labelKey: 'admin.features.items.billing.label',
    descKey: 'admin.features.items.billing.desc',
    read: f => !!f.billing?.enabled,
};

export const ALL_FEATURES: FeatureDef[] = [...MODULE_FEATURES, BILLING_FEATURE];
export const FEATURE_KEYS: FeatureKey[] = ALL_FEATURES.map(f => f.key);

// The five modules the panel ships disabled; everything else is on by default.
// Used by the "Restore defaults" preset (mirrors the config() shipping values).
const DISABLED_BY_DEFAULT: FeatureKey[] = ['custom_domains', 'ai', 'mods', 'email', 'webhooks'];

export const PRESETS: Record<'bareMinimum' | 'everything' | 'defaults', FeatureFlags> = {
    bareMinimum: Object.fromEntries(FEATURE_KEYS.map(k => [k, false])) as FeatureFlags,
    everything: Object.fromEntries(FEATURE_KEYS.map(k => [k, true])) as FeatureFlags,
    defaults: Object.fromEntries(FEATURE_KEYS.map(k => [k, !DISABLED_BY_DEFAULT.includes(k)])) as FeatureFlags,
};

// Read the current flags off the bootstrap payload into a flat toggle map.
export function readFeatureFlags(f: EverestConfiguration): FeatureFlags {
    return Object.fromEntries(ALL_FEATURES.map(def => [def.key, def.read(f)])) as FeatureFlags;
}

// Fold a saved toggle map back into the everest bootstrap object so the live
// Zustand flags store (and therefore the sidebar + route gates) reflect the
// change immediately, without waiting for a full page reload.
export function applyFeatureFlags(everest: EverestConfiguration, flags: FeatureFlags): EverestConfiguration {
    return {
        ...everest,
        custom_domains: { ...everest.custom_domains, enabled: flags.custom_domains },
        ai: { ...everest.ai, enabled: flags.ai },
        mods: { ...everest.mods, enabled: flags.mods },
        email: { ...everest.email, module_enabled: flags.email },
        webhooks: { ...everest.webhooks, enabled: flags.webhooks },
        extensions: { ...everest.extensions, enabled: flags.extensions },
        tickets: { ...everest.tickets, enabled: flags.tickets },
        billing: { ...everest.billing, enabled: flags.billing },
    };
}

import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

import type { SiteSettings } from '@/state/settings';

type WindowWithConfig = Window & {
    SiteConfiguration?: SiteSettings;
    PterodactylUser?: {
        language?: string;
    };
};

const { SiteConfiguration, PterodactylUser } = window as WindowWithConfig;
const locale = PterodactylUser?.language || SiteConfiguration?.locale || 'en';
const activityTranslations = SiteConfiguration?.translations?.activity || {};

const normalizeTranslations = (value: unknown): unknown => {
    if (typeof value === 'string') {
        return value.replace(/:([A-Za-z0-9_.-]+)/g, '{{$1}}');
    }

    if (Array.isArray(value)) {
        return value.map(entry => normalizeTranslations(entry));
    }

    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, normalizeTranslations(entry)]));
    }

    return value;
};

i18next.use(initReactI18next).init({
    resources: {
        [locale]: {
            activity: normalizeTranslations(activityTranslations) as Record<string, string>,
        },
    },
    lng: locale,
    fallbackLng: locale,
    ns: ['activity'],
    defaultNS: 'activity',
    interpolation: {
        escapeValue: false,
    },
});

export default i18next;

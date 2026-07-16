import { type VerificationArea, type VerificationRule, type VerificationRules } from '@/state/everest';

export const EMAIL_VERIFICATION_ALERT_TITLE = 'Verify your email to continue';
export const EMAIL_VERIFICATION_ALERT_MESSAGE = 'Please verify your email address to access this feature.';
export const EMAIL_VERIFICATION_ERROR_MESSAGE = 'Verify your email to continue.';
export const EMAIL_VERIFICATION_ERROR_CODE = 'EMAIL_NOT_VERIFIED';

export const EMAIL_VERIFICATION_AREA_LABELS: Record<VerificationArea, string> = {
    billing: 'Billing',
    orders: 'Orders',
    credentials: 'Credentials',
    tickets: 'Tickets',
};

export const DEFAULT_EMAIL_VERIFICATION_RULES: VerificationRules = {
    billing: {
        can_view: true,
        can_interact: false,
    },
    orders: {
        can_view: true,
        can_interact: false,
    },
    credentials: {
        can_view: true,
        can_interact: true,
    },
    tickets: {
        can_view: false,
        can_interact: false,
    },
};

const toBoolean = (value: unknown, fallback: boolean): boolean => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
    }

    return fallback;
};

export const normalizeVerificationRules = (
    rules?: Partial<Record<VerificationArea, Partial<VerificationRule>>> | null,
): VerificationRules => {
    if (!rules || typeof rules !== 'object') {
        return DEFAULT_EMAIL_VERIFICATION_RULES;
    }

    return (Object.keys(DEFAULT_EMAIL_VERIFICATION_RULES) as VerificationArea[]).reduce((acc, area) => {
        const incoming = rules[area] ?? {};
        const defaults = DEFAULT_EMAIL_VERIFICATION_RULES[area];
        acc[area] = {
            can_view: toBoolean(incoming.can_view, defaults.can_view),
            can_interact: toBoolean(incoming.can_interact, defaults.can_interact),
        };
        return acc;
    }, {} as VerificationRules);
};

export const getAreaForPath = (path: string): VerificationArea | null => {
    if (path.startsWith('billing/orders')) return 'orders';
    if (path.startsWith('billing/')) return 'billing';
    if (path.startsWith('credentials')) return 'credentials';
    if (path.startsWith('tickets')) return 'tickets';

    return null;
};

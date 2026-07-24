import http from '@/lib/http';

// Account-settings API. Mirrors V1's api/routes/account/* against the existing
// /api/client/account/* endpoints — no backend changes. Wire shapes are the
// bare JSON the AccountController returns.

export async function updateEmail(email: string, password: string): Promise<void> {
    await http.put('/api/client/account/email', { email, password });
}

export interface UpdatePasswordInput {
    current: string;
    password: string;
    confirmPassword: string;
}

export async function updatePassword({ current, password, confirmPassword }: UpdatePasswordInput): Promise<void> {
    await http.put('/api/client/account/password', {
        current_password: current,
        password,
        password_confirmation: confirmPassword,
    });
}

// Save the user's preferred panel language; null clears the preference so the
// account follows the panel-wide default. 403s when admins disabled overrides.
export async function updateLanguage(language: string | null): Promise<void> {
    await http.put('/api/client/account/language', { language });
}

// ---- linked SSO accounts ----------------------------------------------------

export type SsoProvider = 'discord' | 'google';

export interface LinkedSsoAccount {
    provider: SsoProvider;
    label: string;
    /** Whether the module is switched on panel-wide. */
    enabled: boolean;
    linked: boolean;
    username: string | null;
    email: string | null;
    linked_at: string | null;
}

// GET /api/client/account/sso — every known provider with its link state, so the
// settings row can render both "linked" and "available to link" from one call.
export async function getLinkedSsoAccounts(): Promise<LinkedSsoAccount[]> {
    const { data } = await http.get('/api/client/account/sso');
    return data.data;
}

// Returns the OAuth URL to redirect the browser to for linking. The callback
// recognises the link flow from the session and returns to /settings.
export async function getSsoLinkUrl(provider: SsoProvider): Promise<string> {
    const { data } = await http.post(`/api/client/account/sso/${provider}/link`);
    return data.url;
}

// Unlinking removes a sign-in route, so the backend re-authenticates with the
// account password. axios sends a DELETE body under `data`.
export async function unlinkSsoProvider(provider: SsoProvider, password: string): Promise<void> {
    await http.delete(`/api/client/account/sso/${provider}`, { data: { password } });
}

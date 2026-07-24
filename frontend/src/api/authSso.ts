import http, { primeCsrf } from '@/lib/http';

// Provider-agnostic SSO signup/link flow. Both Discord and Google land here
// after their OAuth callback verifies an identity that has no panel account —
// the backend keeps the identity in the session and these endpoints read it.

export type SsoProvider = 'discord' | 'google';

export interface SsoRegistrationData {
    provider: SsoProvider;
    /** Display name for the provider, e.g. "Discord". */
    provider_label: string;
    /** The username on the provider, used to prefill the signup form. */
    username: string | null;
    email: string | null;
    provider_user_id: string;
    /** True when a panel account already owns this email — leads with "link" instead of "create". */
    email_taken: boolean;
    registration_enabled: boolean;
}

// GET /auth/sso/registration-data — the pending identity. 404s when the session
// holds none (a direct visit, or an expired flow).
export async function getSsoRegistrationData(): Promise<SsoRegistrationData> {
    const { data } = await http.get('/auth/sso/registration-data');
    return data;
}

export interface SsoUsernameCheck {
    available: boolean;
    message: string;
}

// POST /auth/sso/check-username — live availability (throttled 10/min).
export async function checkSsoUsername(username: string): Promise<SsoUsernameCheck> {
    const { data } = await http.post('/auth/sso/check-username', { username });
    return { available: Boolean(data.available), message: data.message ?? '' };
}

export interface SsoCompleteResult {
    complete: boolean;
    intended?: string;
    /** Set when jGuard is holding the new account — no session was issued. */
    pending: boolean;
    pendingMessage?: string;
    recoveryCode?: string | null;
}

// POST /auth/sso/complete — create the panel account for the verified identity.
// Logs in on success, or returns `pending` when jGuard holds it for approval.
export async function completeSsoRegistration(params: {
    username: string;
    password: string;
    confirmPassword: string;
    captchaToken?: string;
}): Promise<SsoCompleteResult> {
    await primeCsrf();
    const { data } = await http.post('/auth/sso/complete', {
        username: params.username,
        password: params.password,
        confirm_password: params.confirmPassword,
        'cf-turnstile-response': params.captchaToken,
    });
    return {
        complete: Boolean(data.data?.complete),
        intended: data.data?.intended || undefined,
        pending: data.data?.user_state === 'pending',
        pendingMessage: data.data?.pending_message || undefined,
        recoveryCode: data.data?.recovery_code ?? null,
    };
}

// POST /auth/sso/link-intent — record that the user wants this identity attached
// to an account they are about to sign into. The link is only applied once the
// password (and 2FA) challenge is actually met.
export async function startSsoLinkIntent(): Promise<{ provider: SsoProvider; email: string | null }> {
    await primeCsrf();
    const { data } = await http.post('/auth/sso/link-intent');
    return { provider: data.data.provider, email: data.data.email ?? null };
}

// POST /auth/sso/cancel — drop the pending identity from the session.
export async function cancelSsoFlow(): Promise<void> {
    await http.post('/auth/sso/cancel').catch(() => {});
}

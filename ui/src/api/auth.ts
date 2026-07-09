import http, { primeCsrf } from '@/lib/http';

export interface AuthResponse {
    complete: boolean;
    intended?: string;
    confirmationToken?: string;
    /** jGuard: 'pending' when the account was created but needs staff approval. */
    userState?: string | null;
    /** One-time offline recovery code — only present on the register response. */
    recoveryCode?: string | null;
}

// POST /auth/login — same contract as V1 (api/routes/auth/login.ts).
// `user` accepts username or email. Response is wrapped as { data: {...} }.
export async function login(params: {
    user: string;
    password: string;
    captchaToken?: string;
}): Promise<AuthResponse> {
    await primeCsrf();
    const { data } = await http.post('/auth/login', {
        user: params.user,
        password: params.password,
        'cf-turnstile-response': params.captchaToken,
    });
    return {
        complete: data.data.complete,
        intended: data.data.intended || undefined,
        confirmationToken: data.data.confirmation_token || undefined,
    };
}

// POST /auth/login/checkpoint — TOTP / recovery 2FA step.
export async function checkpoint(params: {
    confirmationToken: string;
    code: string;
    recoveryToken?: string;
}): Promise<AuthResponse> {
    const { data } = await http.post('/auth/login/checkpoint', {
        confirmation_token: params.confirmationToken,
        authentication_code: params.code,
        recovery_token: params.recoveryToken && params.recoveryToken.length > 0 ? params.recoveryToken : undefined,
    });
    return { complete: data.data.complete, intended: data.data.intended || undefined };
}

// POST /auth/register — self-signup. Backend auto-logs in on success (unless
// jGuard holds the account as `state: pending`). `password_confirmation` is the
// Laravel `confirmed`-rule field name.
export async function register(params: {
    username: string;
    email: string;
    password: string;
    passwordConfirmation: string;
    captchaToken?: string;
}): Promise<AuthResponse> {
    await primeCsrf();
    const { data } = await http.post('/auth/register', {
        username: params.username,
        email: params.email,
        password: params.password,
        password_confirmation: params.passwordConfirmation,
        'cf-turnstile-response': params.captchaToken,
    });
    return {
        complete: data.data.complete,
        intended: data.data.intended || undefined,
        confirmationToken: data.data.confirmation_token || undefined,
        userState: data.data.user?.state ?? null,
        recoveryCode: data.data.recovery_code ?? null,
    };
}

export interface UsernameCheck {
    available: boolean;
    message: string;
}

// POST /auth/check-username — live availability check (throttled 10/min).
export async function checkUsername(username: string): Promise<UsernameCheck> {
    const { data } = await http.post('/auth/check-username', { username });
    return { available: Boolean(data.available), message: data.message ?? '' };
}

export type PasswordResetMethod = 'email' | 'recovery_code';

// GET /auth/password-reset/method — server decides the reset flow: 'email' when
// email delivery is enabled (send a link), otherwise 'recovery_code'.
export async function getPasswordResetMethod(): Promise<PasswordResetMethod> {
    const { data } = await http.get('/auth/password-reset/method');
    return data.method === 'recovery_code' ? 'recovery_code' : 'email';
}

// POST /auth/password-reset/email — email method step 1. Always resolves with a
// generic message (no account enumeration).
export async function requestPasswordResetEmail(params: {
    email: string;
    captchaToken?: string;
}): Promise<string> {
    await primeCsrf();
    const { data } = await http.post('/auth/password-reset/email', {
        email: params.email,
        'cf-turnstile-response': params.captchaToken,
    });
    return data.message ?? '';
}

// POST /auth/password-reset/reset — email method step 2, submitted from the
// emailed link landing page. Pairs with PasswordResetService's token.
export async function resetPasswordWithToken(params: {
    email: string;
    token: string;
    password: string;
    captchaToken?: string;
}): Promise<boolean> {
    await primeCsrf();
    const { data } = await http.post('/auth/password-reset/reset', {
        email: params.email,
        token: params.token,
        password: params.password,
        password_confirmation: params.password,
        'cf-turnstile-response': params.captchaToken,
    });
    return Boolean(data.success);
}

export interface RecoveryResetResult {
    /** True when the backend logged the user in (no 2FA). */
    complete: boolean;
    intended?: string;
    /** Set when the account has 2FA and must re-login. */
    redirectTo?: string;
}

// POST /auth/password — recovery-code method (single-step). Note the field is
// `password_confirmation` (the Laravel `confirmed` rule); V1 sent `password_confirm`,
// which the backend ignores — do not copy that.
export async function resetPasswordWithRecoveryCode(params: {
    email: string;
    code: string;
    password: string;
    captchaToken?: string;
}): Promise<RecoveryResetResult> {
    await primeCsrf();
    const { data } = await http.post('/auth/password', {
        email: params.email,
        code: params.code,
        password: params.password,
        password_confirmation: params.password,
        'cf-turnstile-response': params.captchaToken,
    });
    // 2FA users get a redirect_to; everyone else gets the login-response shape.
    if (data.redirect_to) {
        return { complete: false, redirectTo: data.redirect_to };
    }
    return {
        complete: Boolean(data.data?.complete),
        intended: data.data?.intended || undefined,
    };
}

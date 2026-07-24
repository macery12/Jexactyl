import http from '@/lib/http';

export interface TwoFactorSetup {
    imageUrlData: string;
    secret: string;
}

// GET /api/client/account/two-factor — generates a TOTP secret and returns the
// otpauth:// URI (for the QR) plus the raw secret. 400s if 2FA is already on.
export async function getTwoFactorSetup(): Promise<TwoFactorSetup> {
    const { data } = await http.get('/api/client/account/two-factor');
    return { imageUrlData: data.data.image_url_data, secret: data.data.secret };
}

// POST /api/client/account/two-factor — verifies the code + password and enables
// 2FA, returning the one-time recovery tokens.
export async function enableTwoFactor(code: string, password: string): Promise<string[]> {
    const { data } = await http.post('/api/client/account/two-factor', { code, password });
    return data.attributes.tokens;
}

// POST /api/client/account/two-factor/disable — disables 2FA after re-auth with
// the password *and* the second factor itself. Send exactly one of code /
// recoveryToken: the backend takes the recovery branch whenever a token is
// present, so passing both would ignore a perfectly good code.
export async function disableTwoFactor(
    password: string,
    second: { code?: string; recoveryToken?: string },
): Promise<void> {
    const useRecovery = Boolean(second.recoveryToken && second.recoveryToken.length > 0);

    await http.post('/api/client/account/two-factor/disable', {
        password,
        code: useRecovery ? undefined : second.code,
        recovery_token: useRecovery ? second.recoveryToken : undefined,
    });
}

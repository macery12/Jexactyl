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

// ---- discord ---------------------------------------------------------------

// Returns the OAuth URL to redirect the browser to for linking. The unlink
// endpoint just detaches the association server-side.
export async function getDiscordLinkUrl(): Promise<string> {
    const { data } = await http.post('/api/client/account/discord/link');
    return data.url;
}

export async function unlinkDiscord(): Promise<void> {
    await http.post('/api/client/account/discord/unlink');
}

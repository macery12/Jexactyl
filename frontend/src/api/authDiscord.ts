import http, { primeCsrf } from '@/lib/http';

// Discord SSO signup flow (V1 parity: api/routes/auth/discord.ts). These endpoints
// live under the unauthenticated /auth/modules/discord/* tree and read the OAuth
// session the callback stashed server-side.

export interface DiscordRegistrationData {
    discord_username: string;
    discord_email: string;
    discord_id: string;
}

// GET /auth/modules/discord/registration-data — the pending OAuth identity.
// 404s (with a redirect back to login) when no Discord session is present.
export async function getDiscordRegistrationData(): Promise<DiscordRegistrationData> {
    const { data } = await http.get('/auth/modules/discord/registration-data');
    return data;
}

export interface DiscordUsernameCheck {
    available: boolean;
    message: string;
}

// POST /auth/modules/discord/check-username — live availability, mirrors the
// email-signup checker but scoped to the Discord flow.
export async function checkDiscordUsername(username: string): Promise<DiscordUsernameCheck> {
    const { data } = await http.post('/auth/modules/discord/check-username', { username });
    return { available: Boolean(data.available), message: data.message ?? '' };
}

// POST /auth/modules/discord/complete — finalise the account (username + SFTP
// password). Backend auto-logs in (or holds `state: pending` under jGuard).
export async function completeDiscordRegistration(params: {
    username: string;
    password: string;
    confirm_password: string;
}): Promise<{ userState: string | null }> {
    await primeCsrf();
    const { data } = await http.post('/auth/modules/discord/complete', {
        username: params.username,
        password: params.password,
        confirm_password: params.confirm_password,
    });
    return { userState: data?.data?.user?.state ?? null };
}

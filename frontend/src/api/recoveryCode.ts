import http from '@/lib/http';

export interface RecoveryCodeStatus {
    /** Whether a hashed recovery code exists on the account. */
    hasCode: boolean;
    /** Whether the user has generated/acknowledged a code since it was last reset. */
    seen: boolean;
}

// GET /api/client/account/recovery-code — reports state only. The code is stored
// hashed and can never be read back, so this drives the "not yet saved" nudge.
export async function getRecoveryCodeStatus(): Promise<RecoveryCodeStatus> {
    const { data } = await http.get('/api/client/account/recovery-code');
    return {
        hasCode: Boolean(data.attributes.has_code),
        seen: Boolean(data.attributes.seen),
    };
}

// POST /api/client/account/recovery-code — re-auth with password, then generate a
// fresh code (invalidating any previous one) and return the plaintext exactly once.
export async function regenerateRecoveryCode(password: string): Promise<string> {
    const { data } = await http.post('/api/client/account/recovery-code', { password });
    return data.attributes.code as string;
}

// POST /api/client/account/recovery-code/acknowledge — marks the code as saved so
// the "not saved" nudge clears. Called after the one-time registration reveal.
export async function acknowledgeRecoveryCode(): Promise<void> {
    await http.post('/api/client/account/recovery-code/acknowledge');
}

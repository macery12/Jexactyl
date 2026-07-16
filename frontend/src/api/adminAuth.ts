import http from '@/lib/http';

// Admin authentication module management (V1 parity: api/routes/admin/auth/*).
// All endpoints sit under /api/application/auth and gate on the auth.* admin
// permissions.

export type AuthModuleName = 'onboarding' | 'jguard' | 'discord' | 'google';

// POST /api/application/auth/modules/{enable|disable}. The controller reads the
// module name as the first positional body value ($request->all()[0]), so the
// bare string is posted as the request body exactly as V1 did — do not wrap it.
export async function toggleAuthModule(action: 'enable' | 'disable', name: AuthModuleName): Promise<void> {
    await http.post(`/api/application/auth/modules/${action}`, name);
}

// PUT /api/application/auth/modules — single key/value at a time.
export async function updateAuthModule(module: string, key: string, value: unknown): Promise<void> {
    await http.put('/api/application/auth/modules', { module, key, value });
}

export interface JGuardPendingUser {
    id: number;
    user_id: number;
    username: string;
    email: string;
    status: 'pending' | 'approved' | 'rejected';
    approval_mode: 'manual' | 'delayed';
    expires_at: string | null;
    created_at: string;
}

// GET /api/application/auth/jguard/pending?status=
export async function getJGuardPending(status = 'pending'): Promise<JGuardPendingUser[]> {
    const { data } = await http.get('/api/application/auth/jguard/pending', { params: { status } });
    return data.data;
}

export async function approveJGuardUser(userId: number): Promise<void> {
    await http.post(`/api/application/auth/jguard/approve/${userId}`);
}

export async function rejectJGuardUser(userId: number): Promise<void> {
    await http.post(`/api/application/auth/jguard/reject/${userId}`);
}

export interface JGuardSettingsValues {
    approval_mode?: 'manual' | 'delayed';
    delay?: number;
    pending_message?: string;
}

// PATCH /api/application/auth/jguard/settings
export async function updateJGuardSettings(values: JGuardSettingsValues): Promise<void> {
    await http.patch('/api/application/auth/jguard/settings', values);
}

import http from '@/lib/http';

// Account device sessions. Mirrors V1's security page against the existing
// /api/client/account/sessions/* endpoints (SessionController) — no backend
// changes. Wire shape is the Fractal collection: `data[]` with `attributes`.
export interface UserSession {
    id: string;
    deviceName: string;
    deviceLabel: string | null;
    ip: string | null;
    location: string | null;
    userAgent: string | null;
    createdAt: string | null;
    lastActivityAt: string | null;
    revokedAt: string | null;
    isCurrent: boolean;
}

interface SessionRow {
    attributes: {
        id: number | string;
        device_name?: string;
        device_label?: string | null;
        ip_address?: string | null;
        location?: string | null;
        user_agent?: string | null;
        created_at?: string | null;
        last_activity_at?: string | null;
        revoked_at?: string | null;
        is_current?: boolean;
    };
}

function mapSession(row: SessionRow): UserSession {
    const a = row.attributes;
    return {
        id: String(a.id),
        deviceName: a.device_name || 'Unknown device',
        deviceLabel: a.device_label ?? null,
        ip: a.ip_address ?? null,
        location: a.location ?? null,
        userAgent: a.user_agent ?? null,
        createdAt: a.created_at ?? null,
        lastActivityAt: a.last_activity_at ?? null,
        revokedAt: a.revoked_at ?? null,
        isCurrent: Boolean(a.is_current),
    };
}

// GET /api/client/account/sessions — active (non-revoked) sessions.
export async function getSessions(): Promise<UserSession[]> {
    const { data } = await http.get('/api/client/account/sessions');
    return (data.data ?? []).map(mapSession);
}

// GET /api/client/account/sessions/history — recently revoked sessions.
export async function getSessionHistory(): Promise<UserSession[]> {
    const { data } = await http.get('/api/client/account/sessions/history');
    return (data.data ?? []).map(mapSession);
}

// POST /api/client/account/sessions/{id}/revoke — sign out one device.
export async function revokeSession(id: string): Promise<void> {
    await http.post(`/api/client/account/sessions/${id}/revoke`);
}

// POST /api/client/account/sessions/revoke-all — sign out everywhere. Keeps the
// current session unless `includeCurrent` is set.
export async function revokeAllSessions(includeCurrent = false): Promise<void> {
    await http.post('/api/client/account/sessions/revoke-all', { include_current: includeCurrent });
}

// PATCH /api/client/account/sessions/{id}/label — set/clear a custom device name.
export async function updateSessionLabel(id: string, label: string | null): Promise<void> {
    await http.patch(`/api/client/account/sessions/${id}/label`, { label });
}

import http from '@/lib/http';

// Admin database-hosts module (Application API). Mirrors V1's
// `resources/scripts/api/routes/admin/databases/*` — the MySQL host connections
// the Panel provisions per-server databases onto. No backend changes: reuses the
// existing `/api/application/databases` surface (list / view / store / update /
// delete). The password is write-only and never returned by the transformer.

export interface DatabaseHost {
    id: number;
    name: string;
    host: string;
    port: number;
    username: string;
    createdAt: string;
    updatedAt: string;
}

// A Fractal collection row: `{ object, attributes }`.
interface FractalHost {
    attributes: {
        id: number;
        name: string;
        host: string;
        port: number;
        username: string;
        created_at: string;
        updated_at: string;
    };
}

function toHost({ attributes: a }: FractalHost): DatabaseHost {
    return {
        id: a.id,
        name: a.name,
        host: a.host,
        port: a.port,
        username: a.username,
        createdAt: a.created_at,
        updatedAt: a.updated_at,
    };
}

// The convenience address the V1 UI shows/copies for a host.
export function hostAddress(h: DatabaseHost): string {
    return `${h.host}:${h.port}`;
}

// Matches StoreDatabaseRequest / DatabaseHost::$validationRules (snake_case).
// `password` is optional on update — omitting it keeps the stored credential.
export interface DatabaseHostPayload {
    name: string;
    host: string;
    port: number;
    username: string;
    password?: string;
}

// GET /api/application/databases — every host. The index caps per_page at 100.
export async function getDatabaseHosts(): Promise<DatabaseHost[]> {
    const { data } = await http.get('/api/application/databases', { params: { per_page: 100 } });
    return (data.data ?? []).map(toHost);
}

export async function createDatabaseHost(payload: DatabaseHostPayload): Promise<DatabaseHost> {
    const { data } = await http.post('/api/application/databases', payload);
    return toHost(data);
}

export async function updateDatabaseHost(id: number, payload: DatabaseHostPayload): Promise<DatabaseHost> {
    const { data } = await http.patch(`/api/application/databases/${id}`, payload);
    return toHost(data);
}

export async function deleteDatabaseHost(id: number): Promise<void> {
    await http.delete(`/api/application/databases/${id}`);
}

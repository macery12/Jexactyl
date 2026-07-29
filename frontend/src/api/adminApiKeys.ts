import http from '@/lib/http';

// Administrative (application) API keys, backed by /api/application/api
// (Fractal collection of ApiKeyTransformer). These are the panel-wide keys that
// authenticate against the application API, gated behind api.read/create/delete.
// Effective access is the intersection of the owner's AdminRole and the key's
// per-resource scope.

export const ADMIN_API_KEY_RESOURCES = [
    'servers',
    'nodes',
    'allocations',
    'users',
    'locations',
    'nests',
    'eggs',
    'database_hosts',
    'server_databases',
] as const;

export type AdminApiKeyResource = (typeof ADMIN_API_KEY_RESOURCES)[number];
export type AdminApiKeyGrant = 'none' | 'read' | 'write';
export type AdminApiKeyPermissions = Record<AdminApiKeyResource, AdminApiKeyGrant>;

export function emptyAdminApiKeyPermissions(): AdminApiKeyPermissions {
    return Object.fromEntries(ADMIN_API_KEY_RESOURCES.map(resource => [resource, 'none'])) as AdminApiKeyPermissions;
}

function normalizePermissions(input?: Partial<AdminApiKeyPermissions>): AdminApiKeyPermissions {
    const permissions = emptyAdminApiKeyPermissions();
    for (const resource of ADMIN_API_KEY_RESOURCES) {
        const grant = input?.[resource];
        permissions[resource] = grant === 'read' || grant === 'write' ? grant : 'none';
    }

    return permissions;
}

export interface AdminApiKey {
    id: number;
    identifier: string;
    description: string | null;
    allowedIps: string[];
    createdAt: string;
    lastUsedAt: string | null;
    legacy: boolean;
    permissions: AdminApiKeyPermissions;
}

export interface AdminApiKeyPagination {
    currentPage: number;
    totalPages: number;
    total: number;
    perPage: number;
}

export interface AdminApiKeyPage {
    items: AdminApiKey[];
    pagination: AdminApiKeyPagination;
}

interface RawApiKeyRow {
    attributes: {
        id: number;
        identifier: string;
        description?: string | null;
        allowed_ips?: string[] | null;
        created_at: string;
        last_used_at?: string | null;
        legacy?: boolean;
        permissions?: Partial<AdminApiKeyPermissions>;
    };
}

// GET /api/application/api — paginated list of application API keys.
export async function getAdminApiKeys(page = 1, perPage = 25): Promise<AdminApiKeyPage> {
    const { data } = await http.get('/api/application/api', {
        params: { page, per_page: perPage, sort: '-id' },
    });
    const p = data.meta?.pagination ?? {};

    return {
        items: (data.data ?? []).map((row: RawApiKeyRow) => {
            const a = row.attributes;
            const lastUsed = a.last_used_at && new Date(a.last_used_at).getTime() > 0 ? a.last_used_at : null;
            return {
                id: a.id,
                identifier: a.identifier,
                description: a.description && a.description.length > 0 ? a.description : null,
                allowedIps: a.allowed_ips ?? [],
                createdAt: a.created_at,
                lastUsedAt: lastUsed,
                legacy: a.legacy ?? true,
                permissions: normalizePermissions(a.permissions),
            };
        }),
        pagination: {
            currentPage: p.current_page ?? 1,
            totalPages: p.total_pages ?? 1,
            total: p.total ?? 0,
            perPage: p.per_page ?? perPage,
        },
    };
}

// POST /api/application/api — create a key; returns the full token, shown once.
export async function createAdminApiKey(memo: string, permissions: AdminApiKeyPermissions): Promise<string> {
    const { data } = await http.post('/api/application/api', { memo, permissions });
    return data.token as string;
}

// DELETE /api/application/api/{id} — revoke a key.
export async function deleteAdminApiKey(id: number): Promise<void> {
    await http.delete(`/api/application/api/${id}`);
}

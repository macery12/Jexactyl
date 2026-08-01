import http from '@/lib/http';
import type { AdminRole } from './adminRoles';

// Administrative (application) API keys, backed by /api/application/api
// (Fractal collection of ApiKeyTransformer). New keys bind to exactly one
// API-eligible access profile, which is their sole capability source; optional
// expiry and IP restrictions narrow when and where the credential may be used.
// The legacy resource fields below are parsed only for rolling compatibility
// with unbound historical keys and are never sent by the current create flow.

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
    expiresAt: string | null;
    legacy: boolean;
    permissions: AdminApiKeyPermissions;
    accessProfile: Pick<AdminRole, 'id' | 'name' | 'color' | 'isOwner'> | null;
    creator: { id: number; username: string; email: string | null } | null;
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
        expires_at?: string | null;
        legacy?: boolean;
        permissions?: Partial<AdminApiKeyPermissions>;
        access_profile_id?: number | null;
        admin_role_id?: number | null;
        access_profile?: Record<string, unknown> | null;
        profile?: Record<string, unknown> | null;
        admin_role?: Record<string, unknown> | null;
        creator?: Record<string, unknown> | null;
        user?: Record<string, unknown> | null;
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
            const rawProfileContainer = a.access_profile ?? a.profile ?? a.admin_role;
            const rawCreatorContainer = a.creator ?? a.user;
            const rawProfile = (
                rawProfileContainer?.attributes && typeof rawProfileContainer.attributes === 'object'
                    ? rawProfileContainer.attributes
                    : rawProfileContainer
            ) as Record<string, unknown> | null | undefined;
            const rawCreator = (
                rawCreatorContainer?.attributes && typeof rawCreatorContainer.attributes === 'object'
                    ? rawCreatorContainer.attributes
                    : rawCreatorContainer
            ) as Record<string, unknown> | null | undefined;
            const profileId = Number(
                rawProfile?.id ??
                    a.access_profile_id ??
                    a.admin_role_id ??
                    0,
            );
            const creatorId = Number(rawCreator?.id ?? 0);
            return {
                id: a.id,
                identifier: a.identifier,
                description: a.description && a.description.length > 0 ? a.description : null,
                allowedIps: a.allowed_ips ?? [],
                createdAt: a.created_at,
                lastUsedAt: lastUsed,
                expiresAt: a.expires_at ?? null,
                legacy: a.legacy ?? true,
                permissions: normalizePermissions(a.permissions),
                accessProfile:
                    profileId > 0
                        ? {
                              id: profileId,
                              name: String(rawProfile?.name ?? 'Unknown profile'),
                              color: typeof rawProfile?.color === 'string' ? rawProfile.color : null,
                              isOwner: Boolean(rawProfile?.is_owner),
                          }
                        : null,
                creator:
                    creatorId > 0
                        ? {
                              id: creatorId,
                              username: String(rawCreator?.username ?? 'Unknown user'),
                              email: typeof rawCreator?.email === 'string' ? rawCreator.email : null,
                          }
                        : null,
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

export interface CreateAdminApiKeyInput {
    memo: string;
    accessProfileId: number;
    allowedIps: string[];
    expiresAt: string | null;
}

// POST /api/application/api — create a profile-bound key; returns its secret once.
export async function createAdminApiKey(input: CreateAdminApiKeyInput): Promise<string> {
    const { data } = await http.post('/api/application/api', {
        memo: input.memo,
        access_profile_id: input.accessProfileId,
        allowed_ips: input.allowedIps,
        expires_at: input.expiresAt,
    });
    return data.token as string;
}

// DELETE /api/application/api/{id} — revoke a key.
export async function deleteAdminApiKey(id: number): Promise<void> {
    await http.delete(`/api/application/api/${id}`);
}

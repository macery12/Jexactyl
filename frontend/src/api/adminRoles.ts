import http from '@/lib/http';

// Admin role management, backed by /api/application/roles (Fractal collection of
// AdminRoleTransformer). Roles carry a name, description, color, and a flat list
// of dotted permission strings (e.g. "users.read"). The available permission
// catalog is served separately, grouped by namespace, from /roles/permissions.

export interface AdminRole {
    id: number;
    name: string;
    description: string | null;
    color: string | null;
    permissions: string[];
    /** Built-in profile that cannot be renamed, edited, or deleted. */
    isSystem: boolean;
    /** The protected full-access Owner profile. */
    isOwner: boolean;
    /** Whether this profile may be assigned to an Application API key. */
    apiEligible: boolean;
    /** People holding this profile; null when the endpoint did not report counts. */
    assignedUsers: number | null;
    /** Application API keys bound to this profile; null when not reported. */
    assignedApiKeys: number | null;
}

export interface AdminRolePagination {
    currentPage: number;
    totalPages: number;
    total: number;
    perPage: number;
}

export interface AdminRolePage {
    items: AdminRole[];
    pagination: AdminRolePagination;
}

interface RawRoleAttributes {
    id: number;
    name: string;
    description: string | null;
    color: string | null;
    permissions: string[] | null;
    is_system?: boolean;
    is_owner?: boolean;
    api_eligible?: boolean;
    assigned_users_count?: number;
    assigned_api_keys_count?: number;
}

function mapRole(row: { attributes?: RawRoleAttributes } & Partial<RawRoleAttributes>): AdminRole {
    const a = (row.attributes ?? row) as RawRoleAttributes;
    return {
        id: a.id,
        name: a.name,
        description: a.description ?? null,
        color: a.color ?? null,
        permissions: a.permissions ?? [],
        isSystem: Boolean(a.is_system),
        isOwner: Boolean(a.is_owner),
        apiEligible: Boolean(a.api_eligible),
        // Absent on endpoints that do not eager-load the counts (the API key
        // profile picker), so `null` means "unknown", never "none assigned".
        assignedUsers: a.assigned_users_count ?? null,
        assignedApiKeys: a.assigned_api_keys_count ?? null,
    };
}

// The permission catalog: namespace -> { human description, key -> description }.
// Rendered as grouped cards, with each permission id formed as `${group}.${key}`.
export type AdminPermissionGroups = Record<string, { description: string; keys: Record<string, string> }>;

export interface AdminRoleQuery {
    page?: number;
    perPage?: number;
}

// GET /api/application/roles
export async function getAdminRoles(query: AdminRoleQuery = {}): Promise<AdminRolePage> {
    const params: Record<string, unknown> = {
        page: query.page ?? 1,
        per_page: query.perPage ?? 100,
    };
    const { data } = await http.get('/api/application/roles', { params });
    const p = data.meta?.pagination ?? {};

    return {
        items: (data.data ?? []).map(mapRole),
        pagination: {
            currentPage: p.current_page ?? 1,
            totalPages: p.total_pages ?? 1,
            total: p.total ?? 0,
            perPage: p.per_page ?? (query.perPage ?? 100),
        },
    };
}

/**
 * Profiles offered by the Application API key form. Newer backends expose a
 * purpose-built alias authorized by api.create; the legacy roles endpoint is a
 * 404-only fallback for rolling upgrades.
 */
export async function getApiEligibleAccessProfiles(): Promise<AdminRole[]> {
    try {
        const { data } = await http.get('/api/application/api/access-profiles');
        return (data.data ?? [])
            .map((row: Parameters<typeof mapRole>[0]) => mapRole(row))
            .filter((profile: AdminRole) => profile.apiEligible && !profile.isOwner);
    } catch (error) {
        if ((error as { response?: { status?: number } }).response?.status !== 404) throw error;
        const page = await getAdminRoles({ perPage: 100 });
        return page.items.filter(profile => profile.apiEligible && !profile.isOwner);
    }
}

// GET /api/application/roles/{id}
export async function getAdminRole(id: number): Promise<AdminRole> {
    const { data } = await http.get(`/api/application/roles/${id}`);
    return mapRole(data);
}

// GET /api/application/roles/permissions — the full assignable permission catalog.
export async function getPermissionGroups(): Promise<AdminPermissionGroups> {
    const { data } = await http.get('/api/application/roles/permissions');
    return (data.attributes?.permissions ?? {}) as AdminPermissionGroups;
}

export interface RoleMetaInput {
    name: string;
    description?: string | null;
    color?: string | null;
    permissions?: string[];
    apiEligible?: boolean;
}

function toPayload(input: Partial<RoleMetaInput>): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    if (input.name !== undefined) payload.name = input.name;
    if (input.description !== undefined) payload.description = input.description || null;
    if (input.color !== undefined) payload.color = input.color || null;
    if (input.permissions !== undefined) payload.permissions = input.permissions;
    if (input.apiEligible !== undefined) payload.api_eligible = input.apiEligible;
    return payload;
}

// POST /api/application/roles
export async function createRole(input: RoleMetaInput): Promise<AdminRole> {
    const { data } = await http.post('/api/application/roles', toPayload(input));
    return mapRole(data);
}

// PATCH /api/application/roles/{id} — updates metadata (name/description/color).
export async function updateRole(id: number, input: Partial<RoleMetaInput>): Promise<AdminRole> {
    const { data } = await http.patch(`/api/application/roles/${id}`, toPayload(input));
    return mapRole(data);
}

// PATCH /api/application/roles/{id}/permissions — replaces the permission set.
export async function updateRolePermissions(id: number, permissions: string[]): Promise<AdminRole> {
    const { data } = await http.patch(`/api/application/roles/${id}/permissions`, { permissions });
    return mapRole(data);
}

// DELETE /api/application/roles/{id} — also unassigns the role from any users.
export async function deleteRole(id: number): Promise<void> {
    await http.delete(`/api/application/roles/${id}`);
}

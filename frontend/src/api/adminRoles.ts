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
}

function mapRole(row: { attributes?: RawRoleAttributes } & Partial<RawRoleAttributes>): AdminRole {
    const a = (row.attributes ?? row) as RawRoleAttributes;
    return {
        id: a.id,
        name: a.name,
        description: a.description ?? null,
        color: a.color ?? null,
        permissions: a.permissions ?? [],
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
}

function toPayload(input: Partial<RoleMetaInput>): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    if (input.name !== undefined) payload.name = input.name;
    if (input.description !== undefined) payload.description = input.description || null;
    if (input.color !== undefined) payload.color = input.color || null;
    if (input.permissions !== undefined) payload.permissions = input.permissions;
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

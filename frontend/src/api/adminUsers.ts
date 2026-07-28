import http from '@/lib/http';

// Admin user management, backed by the session-authed application API
// (/api/application/users, Fractal collection of UserTransformer). Field names
// mirror the transformer output; the write helpers map to the store/update
// request whitelist (external_id, email, username, password, admin_role_id,
// root_admin) plus the dedicated suspend + verify-email endpoints.

export interface AdminUser {
    id: number;
    username: string;
    email: string;
}

// Minimal user list for the server builder's owner picker. This is a SEARCH
// endpoint, not a complete list — the backend caps per_page at 100, so on any
// sizeable panel the unsearched call is just the first page. Callers must expose
// a search box (see Combobox) rather than treating the result as exhaustive.
// `filter[*]` is the backend's wildcard (uuid/username/email/external_id), the
// same one the users list page uses; filtering on email alone missed usernames.
export async function getUsers(search?: string): Promise<AdminUser[]> {
    const params: Record<string, unknown> = { per_page: 100 };
    if (search) params['filter[*]'] = search;
    const { data } = await http.get('/api/application/users', { params });
    return (data.data ?? []).map((row: { attributes?: RawUserAttributes } & Partial<RawUserAttributes>) => {
        const a = (row.attributes ?? row) as RawUserAttributes;
        return { id: a.id, username: a.username, email: a.email };
    });
}

export interface AdminUserRow {
    id: number;
    uuid: string;
    externalId: string | null;
    username: string;
    email: string;
    language: string;
    rootAdmin: boolean;
    adminRoleId: number | null;
    roleName: string;
    twoFactor: boolean;
    avatarUrl: string | null;
    /** Backend stores 'suspended' or an empty/null value. */
    suspended: boolean;
    emailVerified: boolean;
    createdAt: string;
    updatedAt: string | null;
}

export interface AdminUserPagination {
    currentPage: number;
    totalPages: number;
    total: number;
    perPage: number;
}

export interface AdminUserPage {
    items: AdminUserRow[];
    pagination: AdminUserPagination;
}

interface RawUserAttributes {
    id: number;
    uuid: string;
    external_id: string | null;
    username: string;
    email: string;
    language: string;
    root_admin: boolean;
    admin_role_id: number | null;
    role_name: string;
    '2fa': boolean;
    avatar_url: string | null;
    state: string | null;
    email_verified: boolean;
    created_at: string;
    updated_at: string | null;
}

function mapUser(row: { attributes?: RawUserAttributes } & Partial<RawUserAttributes>): AdminUserRow {
    const a = (row.attributes ?? row) as RawUserAttributes;
    return {
        id: a.id,
        uuid: a.uuid,
        externalId: a.external_id ?? null,
        username: a.username,
        email: a.email,
        language: a.language,
        rootAdmin: Boolean(a.root_admin),
        adminRoleId: a.admin_role_id ?? null,
        roleName: a.role_name,
        twoFactor: Boolean(a['2fa']),
        avatarUrl: a.avatar_url ?? null,
        suspended: a.state === 'suspended',
        emailVerified: Boolean(a.email_verified),
        createdAt: a.created_at,
        updatedAt: a.updated_at ?? null,
    };
}

export interface AdminUserQuery {
    page?: number;
    perPage?: number;
    /** Wildcard search across uuid/username/email/external_id. */
    search?: string;
    /** Allowed sort; prefix with '-' for descending. */
    sort?: string;
}

// GET /api/application/users — paginated, searchable admin list.
export async function getAdminUsers(query: AdminUserQuery = {}): Promise<AdminUserPage> {
    const params: Record<string, unknown> = {
        page: query.page ?? 1,
        per_page: query.perPage ?? 25,
    };
    if (query.sort) params.sort = query.sort;
    if (query.search) params['filter[*]'] = query.search;

    const { data } = await http.get('/api/application/users', { params });
    const p = data.meta?.pagination ?? {};

    return {
        items: (data.data ?? []).map(mapUser),
        pagination: {
            currentPage: p.current_page ?? 1,
            totalPages: p.total_pages ?? 1,
            total: p.total ?? 0,
            perPage: p.per_page ?? (query.perPage ?? 25),
        },
    };
}

export interface CreateUserInput {
    username: string;
    email: string;
    password?: string;
    externalId?: string | null;
    adminRoleId?: number | null;
    rootAdmin?: boolean;
}

function toPayload(input: Partial<CreateUserInput>): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    if (input.username !== undefined) payload.username = input.username;
    if (input.email !== undefined) payload.email = input.email;
    if (input.password) payload.password = input.password;
    if (input.externalId !== undefined) payload.external_id = input.externalId || null;
    if (input.adminRoleId !== undefined) payload.admin_role_id = input.adminRoleId;
    if (input.rootAdmin !== undefined) payload.root_admin = input.rootAdmin;
    return payload;
}

// POST /api/application/users
export async function createUser(input: CreateUserInput): Promise<AdminUserRow> {
    const { data } = await http.post('/api/application/users', toPayload(input));
    return mapUser(data);
}

// PATCH /api/application/users/{id}
export async function updateUser(id: number, input: Partial<CreateUserInput>): Promise<AdminUserRow> {
    const { data } = await http.patch(`/api/application/users/${id}`, toPayload(input));
    return mapUser(data);
}

// DELETE /api/application/users/{id}
export async function deleteUser(id: number): Promise<void> {
    await http.delete(`/api/application/users/${id}`);
}

// POST /api/application/users/{id}/suspend — idempotently suspends the account.
export async function suspendUser(id: number): Promise<void> {
    await http.post(`/api/application/users/${id}/suspend`);
}

// POST /api/application/users/{id}/unsuspend — idempotently restores the account.
export async function unsuspendUser(id: number): Promise<void> {
    await http.post(`/api/application/users/${id}/unsuspend`);
}

// POST /api/application/users/{id}/verify-email — manually set/clear verification.
export async function verifyUserEmail(id: number, verified: boolean): Promise<void> {
    await http.post(`/api/application/users/${id}/verify-email`, { verified });
}

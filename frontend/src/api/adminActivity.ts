import http from '@/lib/http';

// Admin activity log, backed by the session-authed application API
// (/api/application/activity, Fractal collection of ActivityLogTransformer with
// an `actor` include). Field names mirror the transformer output. This surfaces
// admin-scoped events (scope=admin, admin-flagged server events, and legacy
// null-scope admin entries) — distinct from the per-account activity feed in
// that every row carries the acting user (actor) rather than just an IP.

export interface AdminActivityActor {
    uuid: string;
    username: string;
    email: string | null;
    avatarUrl: string | null;
}

export interface AdminActivityEntry {
    id: string;
    event: string;
    description: string | null;
    ip: string | null;
    timestamp: string;
    category?: string;
    severity?: string;
    isApi?: boolean;
    isAdmin?: boolean;
    properties?: Record<string, unknown>;
    hasMetadata?: boolean;
    actor: AdminActivityActor | null;
}

export interface AdminActivityPagination {
    currentPage: number;
    totalPages: number;
    total: number;
    perPage: number;
}

export interface AdminActivityPage {
    items: AdminActivityEntry[];
    pagination: AdminActivityPagination;
}

export interface AdminActivityQuery {
    page?: number;
    perPage?: number;
    /** Free-text search across description, event, ip and actor username/email. */
    search?: string;
    /** Restrict to a single actor (user uuid). */
    actor?: string;
    /** Partial match against the event key (e.g. 'admin:api-keys'). */
    event?: string;
    /** Timestamp sort direction; defaults to newest-first. */
    sort?: '-timestamp' | 'timestamp';
}

interface RawActor {
    uuid: string;
    username: string;
    email?: string | null;
    avatar_url?: string | null;
}

interface RawActivityRow {
    attributes: {
        id?: string;
        event: string;
        description?: string | null;
        ip?: string | null;
        timestamp: string;
        category?: string;
        severity?: string;
        is_api?: boolean;
        is_admin?: boolean;
        properties?: Record<string, unknown>;
        has_additional_metadata?: boolean;
        relationships?: {
            actor?: { attributes?: RawActor } | null;
        };
    };
}

function mapActor(raw?: RawActor): AdminActivityActor | null {
    if (!raw) return null;
    return {
        uuid: raw.uuid,
        username: raw.username,
        email: raw.email ?? null,
        avatarUrl: raw.avatar_url ?? null,
    };
}

// GET /api/application/activity — filterable, paginated admin activity log.
export async function getAdminActivity(query: AdminActivityQuery = {}): Promise<AdminActivityPage> {
    const params: Record<string, unknown> = {
        page: query.page ?? 1,
        per_page: query.perPage ?? 25,
        include: 'actor',
        sort: query.sort ?? '-timestamp',
    };
    if (query.search) params['filter[search]'] = query.search;
    if (query.actor) params['filter[actor]'] = query.actor;
    if (query.event) params['filter[event]'] = query.event;

    const { data } = await http.get('/api/application/activity', { params });
    const p = data.meta?.pagination ?? {};

    return {
        items: (data.data ?? []).map((row: RawActivityRow, i: number) => {
            const a = row.attributes;
            return {
                id: String(a.id ?? i),
                event: a.event,
                description: a.description ?? null,
                ip: a.ip ?? null,
                timestamp: a.timestamp,
                category: a.category,
                severity: a.severity,
                isApi: a.is_api,
                isAdmin: a.is_admin,
                properties: a.properties ?? undefined,
                hasMetadata: a.has_additional_metadata ?? false,
                actor: mapActor(a.relationships?.actor?.attributes),
            };
        }),
        pagination: {
            currentPage: p.current_page ?? 1,
            totalPages: p.total_pages ?? 1,
            total: p.total ?? 0,
            perPage: p.per_page ?? (query.perPage ?? 25),
        },
    };
}

// GET /api/application/activity/users — distinct actors, for the filter dropdown.
export async function getAdminActivityActors(): Promise<{ uuid: string; username: string }[]> {
    const { data } = await http.get('/api/application/activity/users');
    return data.data ?? [];
}

// GET /api/application/activity/events — distinct event keys, for the filter dropdown.
export async function getAdminActivityEvents(): Promise<string[]> {
    const { data } = await http.get('/api/application/activity/events');
    return data.data ?? [];
}

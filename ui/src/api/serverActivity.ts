import http from '@/lib/http';
import type { ActivityEntry } from '@/api/activity';

// Per-server activity log (/api/client/servers/{id}/activity, Fractal collection
// of the client ActivityLogTransformer with an `actor` include). Two consumers:
// the compact overview panel (getServerActivity) and the full Activity page
// (getServerActivityPage), which adds filters, sorting and pagination.
//
// Note the client transformer nulls `ip` unless the viewer is the actor or an
// admin, so IP is genuinely optional here — unlike the admin feed.

// GET /api/client/servers/{id}/activity — recent activity scoped to one server.
export async function getServerActivity(id: string): Promise<ActivityEntry[]> {
    const { data } = await http.get(`/api/client/servers/${id}/activity`, { params: { per_page: 10 } });
    return (data.data ?? []).map((row: { attributes: Omit<ActivityEntry, 'id'> & { id?: string } }, i: number) => ({
        id: String(row.attributes.id ?? i),
        event: row.attributes.event,
        description: row.attributes.description ?? null,
        ip: row.attributes.ip ?? null,
        timestamp: row.attributes.timestamp,
    }));
}

export interface ServerActivityActor {
    uuid: string;
    username: string;
    email: string | null;
    avatarUrl: string | null;
}

export interface ServerActivityEntry extends ActivityEntry {
    /** 'admin' | 'client' — drives the Admin badge. */
    context?: string;
    /** 'panel' | 'api' | 'ssh' | 'sftp' — drives the source icons. */
    source?: string;
    actor: ServerActivityActor | null;
}

export interface ServerActivityPagination {
    currentPage: number;
    totalPages: number;
    total: number;
    perPage: number;
}

export interface ServerActivityPage {
    items: ServerActivityEntry[];
    pagination: ServerActivityPagination;
}

export interface ServerActivityQuery {
    page?: number;
    perPage?: number;
    /** Free-text search across description, event, ip and actor username/email. */
    search?: string;
    /** Restrict to a single actor (user uuid). */
    actor?: string;
    /** Partial match against the event key (e.g. 'server:file'). */
    event?: string;
    /** Partial match against the originating IP. */
    ip?: string;
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
        context?: string;
        source?: string;
        is_api?: boolean;
        is_admin?: boolean;
        properties?: Record<string, unknown>;
        has_additional_metadata?: boolean;
        relationships?: {
            actor?: { attributes?: RawActor } | null;
        };
    };
}

function mapActor(raw?: RawActor): ServerActivityActor | null {
    if (!raw) return null;
    return {
        uuid: raw.uuid,
        username: raw.username,
        email: raw.email ?? null,
        avatarUrl: raw.avatar_url ?? null,
    };
}

// GET /api/client/servers/{id}/activity — filterable, paginated server activity.
export async function getServerActivityPage(
    server: string,
    query: ServerActivityQuery = {},
): Promise<ServerActivityPage> {
    const params: Record<string, unknown> = {
        page: query.page ?? 1,
        per_page: query.perPage ?? 25,
        include: 'actor',
        sort: query.sort ?? '-timestamp',
    };
    if (query.search) params['filter[search]'] = query.search;
    if (query.actor) params['filter[actor]'] = query.actor;
    if (query.event) params['filter[event]'] = query.event;
    if (query.ip) params['filter[ip]'] = query.ip;

    const { data } = await http.get(`/api/client/servers/${server}/activity`, { params });
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
                context: a.context,
                source: a.source,
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

// GET /api/client/servers/{id}/activity/users — distinct actors, for the filter.
export async function getServerActivityUsers(server: string): Promise<{ uuid: string; username: string }[]> {
    const { data } = await http.get(`/api/client/servers/${server}/activity/users`);
    return data.data ?? [];
}

// GET /api/client/servers/{id}/activity/events — distinct event keys, for the filter.
export async function getServerActivityEvents(server: string): Promise<string[]> {
    const { data } = await http.get(`/api/client/servers/${server}/activity/events`);
    return data.data ?? [];
}

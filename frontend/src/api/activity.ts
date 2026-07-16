import http from '@/lib/http';

export interface ActivityEntry {
    id: string;
    event: string;
    description: string | null;
    ip: string | null;
    timestamp: string;
    // Enriched fields only populated by the full activity list (getActivityPage).
    // Optional so the compact widgets (dashboard, server panel) can omit them.
    category?: string;
    severity?: string;
    isApi?: boolean;
    isAdmin?: boolean;
    // Raw event metadata, surfaced by the click-to-inspect JSON viewer. Present
    // on both the compact feed and the full list.
    properties?: Record<string, unknown>;
    hasMetadata?: boolean;
}

// GET /api/client/account/activity — recent account activity (Fractal list).
export async function getAccountActivity(): Promise<ActivityEntry[]> {
    const { data } = await http.get('/api/client/account/activity', { params: { per_page: 8 } });
    return (data.data ?? []).map((row: RichActivityRow, i: number) => ({
        id: String(row.attributes.id ?? i),
        event: row.attributes.event,
        description: row.attributes.description ?? null,
        ip: row.attributes.ip ?? null,
        timestamp: row.attributes.timestamp,
        properties: row.attributes.properties ?? undefined,
        hasMetadata: row.attributes.has_additional_metadata ?? false,
    }));
}

export interface ActivityPagination {
    current_page: number;
    total_pages: number;
    total: number;
    per_page: number;
}

export interface ActivityPageResult {
    items: ActivityEntry[];
    pagination: ActivityPagination;
}

export interface ActivityQuery {
    page?: number;
    perPage?: number;
    /** Partial match against the event key (e.g. 'auth', 'server:file'). */
    event?: string;
    /** Restrict to account-level or owned-server activity. */
    scope?: 'account' | 'server';
    /** Restrict to a single owned server (uuid). */
    server?: string;
}

interface RichActivityRow {
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
    };
}

// GET /api/client/account/activity — filterable, paginated account + owned-server
// activity. Backs the standalone Activity page.
export async function getActivityPage(query: ActivityQuery = {}): Promise<ActivityPageResult> {
    const params: Record<string, unknown> = {
        page: query.page ?? 1,
        per_page: query.perPage ?? 25,
    };
    if (query.event) params['filter[event]'] = query.event;
    if (query.scope) params['filter[scope]'] = query.scope;
    if (query.server) params['filter[server]'] = query.server;

    const { data } = await http.get('/api/client/account/activity', { params });
    const p = data.meta?.pagination ?? {};

    return {
        items: (data.data ?? []).map((row: RichActivityRow, i: number) => ({
            id: String(row.attributes.id ?? i),
            event: row.attributes.event,
            description: row.attributes.description ?? null,
            ip: row.attributes.ip ?? null,
            timestamp: row.attributes.timestamp,
            category: row.attributes.category,
            severity: row.attributes.severity,
            isApi: row.attributes.is_api,
            isAdmin: row.attributes.is_admin,
            properties: row.attributes.properties ?? undefined,
            hasMetadata: row.attributes.has_additional_metadata ?? false,
        })),
        pagination: {
            current_page: p.current_page ?? 1,
            total_pages: p.total_pages ?? 1,
            total: p.total ?? 0,
            per_page: p.per_page ?? (query.perPage ?? 25),
        },
    };
}

export interface OwnedServer {
    uuid: string;
    name: string;
}

// GET /api/client/account/owned-servers — servers owned by the user, for the
// activity page's server filter dropdown.
export async function getOwnedServers(): Promise<OwnedServer[]> {
    const { data } = await http.get('/api/client/account/owned-servers');
    return data.data ?? [];
}

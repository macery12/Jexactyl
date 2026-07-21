import http from '@/lib/http';
import { dockerImageOptions, type DockerImageOption } from '@/api/nests';
import { toProduct, type BillingProduct } from '@/api/billingProducts';

// Admin server view-models. Sourced from the session-authed application API
// (/api/application/servers) — the same client the node cockpit uses. Field
// names mirror V1's admin Server transformer (ServerTransformer.php).

export type ServerState = 'active' | 'installing' | 'install_failed' | 'suspended' | 'restoring' | 'transferring';

export interface AdminServer {
    id: number;
    uuid: string;
    identifier: string;
    name: string;
    description: string | null;
    // Normalised lifecycle state used for the status dot / badge.
    state: ServerState;
    isDeletionScheduled: boolean;
    nodeId: number;
    nodeName: string | null;
    ownerId: number;
    ownerName: string | null;
    // Per-server limits (MiB for memory/disk, % for cpu; 0 == unlimited).
    limits: { memory: number; disk: number; cpu: number };
}

function toState(status: string | null): ServerState {
    switch (status) {
        case 'suspended':
            return 'suspended';
        case 'installing':
            return 'installing';
        case 'install_failed':
            return 'install_failed';
        case 'restoring_backup':
            return 'restoring';
        case 'transferring':
            return 'transferring';
        default:
            return 'active';
    }
}

interface FractalServer {
    attributes: {
        id: number;
        uuid: string;
        identifier: string;
        name: string;
        description?: string | null;
        status: string | null;
        node_id: number;
        owner_id: number;
        is_deletion_scheduled?: boolean;
        limits: { memory: number; disk: number; cpu: number };
        relationships?: {
            node?: { attributes?: { name?: string } };
            user?: { attributes?: { username?: string; email?: string } };
        };
    };
}

function toAdminServer({ attributes: a }: FractalServer): AdminServer {
    const node = a.relationships?.node?.attributes ?? null;
    const user = a.relationships?.user?.attributes ?? null;
    return {
        id: a.id,
        uuid: a.uuid,
        identifier: a.identifier,
        name: a.name,
        description: a.description && a.description.length > 0 ? a.description : null,
        state: toState(a.status),
        isDeletionScheduled: Boolean(a.is_deletion_scheduled),
        nodeId: a.node_id,
        nodeName: node?.name ?? null,
        ownerId: a.owner_id,
        ownerName: user?.username ?? user?.email ?? null,
        limits: {
            memory: a.limits?.memory ?? 0,
            disk: a.limits?.disk ?? 0,
            cpu: a.limits?.cpu ?? 0,
        },
    };
}

// GET /api/application/servers — every server on the panel, with node + owner.
// The index caps per_page at 100, so we page through to assemble the full fleet.
export async function getAdminServers(): Promise<AdminServer[]> {
    const out: AdminServer[] = [];
    let page = 1;
    // Guard against a runaway loop if pagination meta is ever missing.
    for (let safety = 0; safety < 50; safety++) {
        const { data } = await http.get('/api/application/servers', {
            params: { include: 'node,user', per_page: 100, page },
        });
        out.push(...(data.data ?? []).map(toAdminServer));
        const pagination = data.meta?.pagination;
        if (!pagination || page >= (pagination.total_pages ?? 1)) break;
        page += 1;
    }
    return out;
}

export interface ServerVariableView {
    envVariable: string;
    name: string;
    description: string | null;
    defaultValue: string;
    rules: string | null;
    serverValue: string;
}

export interface ServerAllocationView {
    id: number;
    ip: string;
    port: number;
    alias: string | null;
}

// The full admin view-model for the server cockpit. Sourced from one
// GET /servers/{id}?include=egg,node,user,variables,allocations call.
export interface ServerView {
    id: number;
    uuid: string;
    identifier: string;
    name: string;
    description: string | null;
    externalId: string | null;
    state: ServerState;
    status: string | null;
    isDeletionScheduled: boolean;
    ownerId: number;
    ownerName: string | null;
    nodeId: number;
    nodeName: string | null;
    eggId: number;
    eggName: string | null;
    nestId: number | null;
    allocationId: number | null;
    limits: { memory: number; swap: number; disk: number; io: number; cpu: number; threads: string | null; oom_killer: boolean };
    featureLimits: { allocations: number; backups: number; databases: number; subusers: number; subdomains: number };
    container: { image: string; startup: string; environment: Record<string, string> };
    dockerImages: DockerImageOption[];
    variables: ServerVariableView[];
    allocations: ServerAllocationView[];
    billing: ServerBillingView;
}

// Billing config for the server. `product` is the resolved plan (via the
// `product` include) — null when the server isn't on a plan, or when the plan
// was deleted out from under it while billingProductId still points at it.
export interface ServerBillingView {
    productId: number | null;
    days: number | null;
    renewalDate: string | null;
    product: BillingProduct | null;
}

export async function getServerView(id: number | string): Promise<ServerView> {
    const { data } = await http.get(`/api/application/servers/${id}`, {
        params: { include: 'egg,node,user,variables,allocations,product' },
    });
    const a = data.attributes ?? data;
    const rel = a.relationships ?? {};
    const egg = rel.egg?.attributes ?? null;
    const node = rel.node?.attributes ?? null;
    const user = rel.user?.attributes ?? null;
    const variables = (rel.variables?.data ?? []).map((row: any) => {
        const v = row.attributes ?? row;
        return {
            envVariable: v.env_variable,
            name: v.name,
            description: v.description && v.description.length > 0 ? v.description : null,
            defaultValue: v.default_value ?? '',
            rules: v.rules ?? null,
            serverValue: v.server_value ?? v.default_value ?? '',
        };
    });
    const allocations = (rel.allocations?.data ?? []).map((row: any) => {
        const al = row.attributes ?? row;
        return { id: al.id, ip: al.ip, port: al.port, alias: al.alias ?? null };
    });

    return {
        id: a.id,
        uuid: a.uuid,
        identifier: a.identifier,
        name: a.name,
        description: a.description && a.description.length > 0 ? a.description : null,
        externalId: a.external_id ?? null,
        state: toState(a.status),
        status: a.status ?? null,
        isDeletionScheduled: Boolean(a.is_deletion_scheduled),
        ownerId: a.owner_id,
        ownerName: user?.username ?? user?.email ?? null,
        nodeId: a.node_id,
        nodeName: node?.name ?? null,
        eggId: a.egg_id,
        eggName: egg?.name ?? null,
        nestId: a.nest_id ?? null,
        allocationId: a.allocation_id ?? null,
        limits: {
            memory: a.limits?.memory ?? 0,
            swap: a.limits?.swap ?? 0,
            disk: a.limits?.disk ?? 0,
            io: a.limits?.io ?? 500,
            cpu: a.limits?.cpu ?? 0,
            threads: a.limits?.threads ?? null,
            oom_killer: Boolean(a.limits?.oom_killer),
        },
        featureLimits: {
            allocations: a.feature_limits?.allocations ?? 0,
            backups: a.feature_limits?.backups ?? 0,
            databases: a.feature_limits?.databases ?? 0,
            subusers: a.feature_limits?.subusers ?? 0,
            subdomains: a.feature_limits?.subdomains ?? 0,
        },
        container: {
            image: a.container?.image ?? '',
            startup: a.container?.startup ?? '',
            environment: a.container?.environment ?? {},
        },
        dockerImages: dockerImageOptions(egg?.docker_images ?? []),
        variables,
        allocations,
        billing: {
            productId: a.billing_product_id ?? null,
            days: a.billing_days ?? null,
            renewalDate: a.renewal_date ?? null,
            product: rel.product?.attributes ? toProduct(rel.product) : null,
        },
    };
}

// ---- Mutations --------------------------------------------------------------

// NOTE: POST /api/application/servers/preset is intentionally NOT wrapped here.
// That endpoint auto-assigns owner, name and allocation with no way to override
// them, so the admin UI instead applies a preset into the normal create form
// (see ServerEditorPage) and posts through createServer below. The route stays
// available for API consumers.

// Full manual create — mirrors StoreServerRequest's nested shape.
export interface CreateServerValues {
    name: string;
    description?: string | null;
    owner_id: number;
    node_id: number;
    egg_id: number;
    image: string;
    startup: string;
    environment: Record<string, string>;
    skip_scripts: boolean;
    limits: { memory: number; swap: number; disk: number; io: number; cpu: number; threads: string | null; oom_killer: boolean };
    feature_limits: { allocations: number; backups: number; databases: number; subusers: number };
    allocation: { default: number; additional?: number[] };
}

// Returns the created server's id so the editor can navigate to its cockpit.
export async function createServer(values: CreateServerValues): Promise<{ id: number }> {
    const { data } = await http.post('/api/application/servers', values);
    return { id: data?.attributes?.id };
}

// Edit details + build (PATCH /servers/{id}). Startup/egg/env go through the
// dedicated updateServerStartup call below.
export interface UpdateServerValues {
    name?: string;
    description?: string | null;
    external_id?: string | null;
    owner_id?: number;
    limits?: { memory: number; swap: number; disk: number; io: number; cpu: number; threads: string | null; oom_killer: boolean };
    feature_limits?: { allocations: number; backups: number; databases: number; subusers: number; subdomains: number };
    renewal_date?: string | null;
    billing_product_id?: number | null;
    billing_days?: number | null;
    allocation_id?: number;
    add_allocations?: number[];
    remove_allocations?: number[];
}

export async function updateServer(id: number, values: UpdateServerValues): Promise<void> {
    await http.patch(`/api/application/servers/${id}`, values);
}

// PATCH /servers/{id}/startup — startup command, docker image, egg + env vars.
export interface UpdateServerStartupValues {
    startup: string;
    environment: Record<string, string>;
    egg_id: number;
    image: string;
    skip_scripts: boolean;
}

export async function updateServerStartup(id: number, values: UpdateServerStartupValues): Promise<void> {
    await http.patch(`/api/application/servers/${id}/startup`, values);
}

export async function suspendServer(id: number): Promise<void> {
    await http.post(`/api/application/servers/${id}/suspend`);
}

export async function unsuspendServer(id: number): Promise<void> {
    await http.post(`/api/application/servers/${id}/unsuspend`);
}

export async function reinstallServer(id: number): Promise<void> {
    await http.post(`/api/application/servers/${id}/reinstall`);
}

export async function deleteServer(id: number, force = false): Promise<void> {
    await http.post(`/api/application/servers/${id}/delete`, { force });
}

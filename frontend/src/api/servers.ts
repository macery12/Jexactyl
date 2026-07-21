import http from '@/lib/http';

// Lean view-model for the dashboard list. Mirrors a subset of V1's Server
// transformer (api/definitions/server/transformers.ts) — only what we render.
export interface ServerListItem {
    id: string; // identifier — used in the /server/:id route
    uuid: string;
    name: string;
    description: string | null;
    node: string;
    status: string | null;
    isNodeUnderMaintenance: boolean;
    limits: { memory: number; disk: number; cpu: number };
}

interface FractalServer {
    attributes: {
        identifier: string;
        uuid: string;
        name: string;
        description?: string | null;
        node: string;
        status: string | null;
        is_node_under_maintenance?: boolean;
        limits: { memory: number; disk: number; cpu: number };
    };
}

function toServer({ attributes: a }: FractalServer): ServerListItem {
    return {
        id: a.identifier,
        uuid: a.uuid,
        name: a.name,
        description: a.description && a.description.length > 0 ? a.description : null,
        node: a.node,
        status: a.status,
        isNodeUnderMaintenance: a.is_node_under_maintenance ?? false,
        limits: {
            memory: a.limits?.memory ?? 0,
            disk: a.limits?.disk ?? 0,
            cpu: a.limits?.cpu ?? 0,
        },
    };
}

// GET /api/client — servers the current user can access (same endpoint V1 uses).
// Passing 'admin-all' returns every server on the system; the backend silently
// returns nothing for non-admins, so it is safe to send unconditionally.
export async function getServers(type?: 'admin-all'): Promise<ServerListItem[]> {
    const { data } = await http.get('/api/client', { params: { per_page: 100, type } });
    return (data.data ?? []).map(toServer);
}

// Richer single-server view-model for the server dashboard.
export interface ServerAllocation {
    id: number;
    ip: string;
    alias: string | null;
    port: number;
    isDefault: boolean;
}

export interface ServerDetail extends ServerListItem {
    dockerImage: string;
    isInstalling: boolean;
    isTransferring: boolean;
    isSuspended: boolean;
    isNodeSupercharged: boolean;
    isDeletionScheduled: boolean;
    isOwner: boolean;
    permissions: string[];
    sftp: { ip: string; port: number };
    featureLimits: { databases: number; allocations: number; backups: number; subusers: number };
    allocations: ServerAllocation[];
    /** Numeric primary key. The billing endpoints key off this, not the identifier. */
    internalId: number;
    eggId: number | null;
    // Billing linkage — null on servers created outside the storefront.
    billingProductId: number | null;
    billingDays: number | null;
    renewalDate: string | null;
}

interface FractalRelItem<T> {
    attributes: T;
}

// GET /api/client/servers/{id} — single server with allocations + sftp details.
export async function getServer(id: string): Promise<ServerDetail> {
    const { data } = await http.get(`/api/client/servers/${id}`, {
        params: { include: 'allocations' },
    });
    const a = data.attributes;

    const allocationRows: FractalRelItem<{
        id: number;
        ip: string;
        ip_alias?: string | null;
        port: number;
        is_default: boolean;
    }>[] = a.relationships?.allocations?.data ?? [];

    const allocations: ServerAllocation[] = allocationRows.map(({ attributes: al }) => ({
        id: al.id,
        ip: al.ip,
        alias: al.ip_alias ?? null,
        port: al.port,
        isDefault: al.is_default,
    }));

    const isOwner = data.meta?.is_server_owner ?? false;
    const permissions: string[] = isOwner ? ['*'] : (data.meta?.user_permissions ?? []);

    return {
        ...toServer({ attributes: a }),
        status: a.status,
        dockerImage: a.docker_image ?? '',
        // The transformer only emits `status`; there are no is_installing/is_suspended
        // keys to read, so derive both from it (as V1 did) or the badges never render.
        isInstalling: a.status === 'installing',
        isTransferring: a.is_transferring ?? false,
        isSuspended: a.status === 'suspended',
        isNodeSupercharged: a.is_node_supercharged ?? false,
        isDeletionScheduled: a.is_deletion_scheduled ?? false,
        isOwner,
        permissions,
        sftp: { ip: a.sftp_details?.ip ?? '', port: a.sftp_details?.port ?? 0 },
        featureLimits: {
            databases: a.feature_limits?.databases ?? 0,
            allocations: a.feature_limits?.allocations ?? 0,
            backups: a.feature_limits?.backups ?? 0,
            subusers: a.feature_limits?.subusers ?? 0,
        },
        allocations,
        internalId: a.internal_id,
        eggId: a.egg_id ?? null,
        billingProductId: a.billing_product_id ?? null,
        billingDays: a.billing_days ?? null,
        renewalDate: a.renewal_date ?? null,
    };
}

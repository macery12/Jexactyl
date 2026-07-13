import http from '@/lib/http';

// Lean view-model for the dashboard list. Mirrors a subset of V1's Server
// transformer (api/definitions/server/transformers.ts) — only what we render.
export interface ServerListItem {
    id: string; // identifier — used in the /v2/server/:id route
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
export async function getServers(): Promise<ServerListItem[]> {
    const { data } = await http.get('/api/client', { params: { per_page: 100 } });
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
        isInstalling: a.is_installing ?? false,
        isTransferring: a.is_transferring ?? false,
        isSuspended: a.is_suspended ?? false,
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
    };
}

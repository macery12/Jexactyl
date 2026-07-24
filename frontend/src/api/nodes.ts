import { isAxiosError } from 'axios';
import http from '@/lib/http';

// Admin node view-models. The admin app API (/api/application/*) is session-authed
// same-origin, so the shared http client works exactly as it does for the client API.
// Field names mirror V1's admin Node transformer (api/routes/admin/node.ts).

export type WingsType = 'default' | 'wings-rs';

export interface NodeListItem {
    id: number;
    uuid: string;
    name: string;
    description: string | null;
    fqdn: string;
    scheme: 'http' | 'https';
    isPublic: boolean;
    isBehindProxy: boolean;
    maintenanceMode: boolean;
    // Billing placement flags — which product tier may deploy here. Independent
    // of `isPublic`: that governs auto-deployment, these govern paid vs free
    // purchases (NodeAvailabilityService picks the column off the product).
    deployable: boolean;
    deployableFree: boolean;
    wingsType: WingsType;
    wingsVersion: string | null;
    // Capacity (MiB). `*Overallocate` is a percentage (-1 == unlimited, 0 == none).
    memory: number;
    memoryOverallocate: number;
    disk: number;
    diskOverallocate: number;
    // Sum of limits for servers placed on the node (MiB).
    allocatedMemory: number;
    allocatedDisk: number;
}

export interface NodePorts {
    httpListen: number;
    httpPublic: number;
    sftpListen: number;
    sftpPublic: number;
}

export interface NodeDetail extends NodeListItem {
    daemonBase: string;
    uploadSize: number;
    ports: NodePorts;
    databaseHostId: number | null;
    createdAt: string;
    wingsDetectedAt: string | null;
    // meta.utilization from the node `view` endpoint — percent of capacity in use.
    utilization: { memory: number; disk: number; allocations: number };
}

interface FractalNode {
    attributes: {
        id: number;
        uuid: string;
        name: string;
        description?: string | null;
        fqdn: string;
        scheme: 'http' | 'https';
        public: boolean;
        behind_proxy: boolean;
        maintenance_mode: boolean;
        // Nullable in the schema; absent flags read as "not deployable".
        deployable?: boolean | null;
        deployable_free?: boolean | null;
        wings_type?: string;
        wings_version?: string | null;
        wings_detected_at?: string | null;
        memory: number;
        memory_overallocate: number;
        disk: number;
        disk_overallocate: number;
        upload_size: number;
        daemon_base: string;
        database_host_id?: number | null;
        listen_port_http: number;
        public_port_http: number;
        listen_port_sftp: number;
        public_port_sftp: number;
        created_at: string;
        allocated_resources?: { memory: number; disk: number };
    };
}

function toListItem({ attributes: a }: FractalNode): NodeListItem {
    return {
        id: a.id,
        uuid: a.uuid,
        name: a.name,
        description: a.description && a.description.length > 0 ? a.description : null,
        fqdn: a.fqdn,
        scheme: a.scheme,
        isPublic: a.public,
        isBehindProxy: a.behind_proxy,
        maintenanceMode: a.maintenance_mode,
        deployable: Boolean(a.deployable),
        deployableFree: Boolean(a.deployable_free),
        wingsType: a.wings_type === 'wings-rs' ? 'wings-rs' : 'default',
        wingsVersion: a.wings_version ?? null,
        memory: a.memory,
        memoryOverallocate: a.memory_overallocate,
        disk: a.disk,
        diskOverallocate: a.disk_overallocate,
        allocatedMemory: a.allocated_resources?.memory ?? 0,
        allocatedDisk: a.allocated_resources?.disk ?? 0,
    };
}

// GET /api/application/nodes — the fleet.
export async function getNodes(): Promise<NodeListItem[]> {
    const { data } = await http.get('/api/application/nodes', { params: { per_page: 100 } });
    return (data.data ?? []).map(toListItem);
}

// GET /api/application/nodes/{id} — a single node (with meta.utilization).
// A Fractal item returns `{ object, attributes, meta }` at the top level (unlike
// a collection, which nests rows under `data`).
export async function getNode(id: number | string): Promise<NodeDetail> {
    const { data } = await http.get(`/api/application/nodes/${id}`);
    const base = toListItem(data);
    const a = data.attributes;
    const u = data.meta?.utilization ?? {};
    return {
        ...base,
        daemonBase: a.daemon_base,
        uploadSize: a.upload_size,
        ports: {
            httpListen: a.listen_port_http,
            httpPublic: a.public_port_http,
            sftpListen: a.listen_port_sftp,
            sftpPublic: a.public_port_sftp,
        },
        databaseHostId: a.database_host_id ?? null,
        createdAt: a.created_at,
        wingsDetectedAt: a.wings_detected_at ?? null,
        utilization: {
            memory: Number(u.memory ?? 0),
            disk: Number(u.disk ?? 0),
            allocations: Number(u.allocations ?? 0),
        },
    };
}

// GET /api/application/nodes/{id}/information — live system info from the daemon.
export interface NodeInformation {
    version: string | null;
    system: { type: string; arch: string | null; release: string | null; cpus: number | null; supercharged: boolean };
}

export async function getNodeInformation(id: number | string): Promise<NodeInformation> {
    const { data } = await http.get(`/api/application/nodes/${id}/information`);
    return {
        version: data?.version ?? null,
        system: {
            type: data?.system?.type ?? 'Unknown',
            arch: data?.system?.arch ?? null,
            release: data?.system?.release ?? null,
            cpus: data?.system?.cpus ?? null,
            supercharged: Boolean(data?.system?.supercharged),
        },
    };
}

// GET /api/application/nodes/{id}/utilization — live host CPU/mem/swap/disk (bytes).
export interface NodeUtilization {
    cpu: number;
    memory: { total: number; used: number };
    swap: { total: number; used: number };
    disk: { total: number; used: number };
}

export async function getNodeUtilization(id: number | string): Promise<NodeUtilization> {
    const { data } = await http.get(`/api/application/nodes/${id}/utilization`);
    return {
        cpu: Number(data?.cpu ?? 0),
        memory: { total: Number(data?.memory?.total ?? 0), used: Number(data?.memory?.used ?? 0) },
        swap: { total: Number(data?.swap?.total ?? 0), used: Number(data?.swap?.used ?? 0) },
        disk: { total: Number(data?.disk?.total ?? 0), used: Number(data?.disk?.used ?? 0) },
    };
}

// GET /api/application/nodes/{id}/configuration — the daemon config blob (read-only view).
export async function getNodeConfiguration(id: number | string): Promise<string> {
    const { data } = await http.get(`/api/application/nodes/${id}/configuration`);
    return JSON.stringify(data, null, 4);
}

// Count of servers placed on a node, via the servers index pagination meta.
export async function getNodeServerCount(id: number | string): Promise<number> {
    const { data } = await http.get('/api/application/servers', {
        params: { 'filter[node_id]': id, per_page: 1 },
    });
    return data.meta?.pagination?.total ?? 0;
}

export interface NodeAllocation {
    id: number;
    ip: string;
    alias: string | null;
    port: number;
    isAssigned: boolean;
    serverName: string | null;
}

// GET /api/application/nodes/{id}/allocations — IP:port pool for the node.
// The index caps per_page at 100 (it 400s above that), so page through.
export async function getNodeAllocations(id: number | string): Promise<NodeAllocation[]> {
    const out: NodeAllocation[] = [];
    let page = 1;
    for (let safety = 0; safety < 50; safety++) {
        const { data } = await http.get(`/api/application/nodes/${id}/allocations`, {
            params: { include: 'server', per_page: 100, page },
        });
        for (const row of data.data ?? []) {
            const a = row.attributes;
            const server = a.relationships?.server?.attributes ?? null;
            out.push({
                id: a.id,
                ip: a.ip,
                alias: a.alias ?? null,
                port: a.port,
                isAssigned: a.assigned ?? a.server_id != null,
                serverName: server?.name ?? null,
            });
        }
        const pagination = data.meta?.pagination;
        if (!pagination || page >= (pagination.total_pages ?? 1)) break;
        page += 1;
    }
    return out;
}

// ---- Mutations --------------------------------------------------------------

// Matches StoreNodeRequest (snake_case). Ports default to wings conventions.
export interface NodeFormValues {
    name: string;
    description?: string | null;
    fqdn: string;
    scheme: 'http' | 'https';
    behind_proxy: boolean;
    public: boolean;
    memory: number;
    memory_overallocate: number;
    disk: number;
    disk_overallocate: number;
    listen_port_http: number;
    public_port_http: number;
    listen_port_sftp: number;
    public_port_sftp: number;
    daemon_base?: string;
    upload_size?: number;
    deployable: boolean;
    deployable_free: boolean;
    database_host_id?: number | null;
}

// Returns the created node so the editor can navigate to its detail page.
export async function createNode(values: NodeFormValues): Promise<NodeListItem> {
    const { data } = await http.post('/api/application/nodes', values);
    return toListItem(data);
}

export async function updateNode(id: number, values: Partial<NodeFormValues>): Promise<void> {
    await http.patch(`/api/application/nodes/${id}`, values);
}

export async function deleteNode(id: number): Promise<void> {
    await http.delete(`/api/application/nodes/${id}`);
}

/**
 * GET /api/application/nodes/deployable — nodes with room for a given workload.
 *
 * `memory` and `disk` are REQUIRED by GetDeployableNodesRequest; omitting them
 * 422s, which is what silently emptied the old node picker. Two further quirks
 * of FindViableNodesService worth knowing before using this as a picker source:
 *   - it filters `nodes.public = 1`, so private nodes never appear, and
 *   - it THROWS NoViableNodeException on an empty result instead of returning
 *     [], so "nothing has capacity" arrives as an error, not an empty list.
 *
 * Because of that this is an advisory capacity check, not a node list. Use
 * getNodes() to populate a picker; use this to annotate it. Returns [] for the
 * no-capacity case so callers can treat it as a normal answer.
 */
export async function getDeployableNodes(memory: number, disk: number): Promise<NodeListItem[]> {
    try {
        const { data } = await http.get('/api/application/nodes/deployable', {
            params: { per_page: 100, memory, disk },
        });
        return (data.data ?? []).map(toListItem);
    } catch (err) {
        if (isAxiosError(err) && err.response?.status === 400) return [];
        throw err;
    }
}

export interface AllocationFormValues {
    ip: string;
    alias?: string | null;
    start_port: number;
    end_port?: number | null;
}

export async function createAllocations(nodeId: number, values: AllocationFormValues): Promise<void> {
    await http.post(`/api/application/nodes/${nodeId}/allocations`, values);
}

export async function deleteAllocation(nodeId: number, allocationId: number): Promise<void> {
    await http.delete(`/api/application/nodes/${nodeId}/allocations/${allocationId}`);
}

export interface NodeServer {
    id: number;
    uuid: string;
    name: string;
    status: string | null;
    suspended: boolean;
    memory: number;
    disk: number;
}

// GET /api/application/servers?filter[node_id]= — servers placed on a node.
export async function getNodeServers(id: number | string): Promise<NodeServer[]> {
    const { data } = await http.get('/api/application/servers', {
        params: { 'filter[node_id]': id, per_page: 100 },
    });
    return (data.data ?? []).map((row: any) => {
        const a = row.attributes;
        return {
            id: a.id,
            uuid: a.uuid,
            name: a.name,
            status: a.status ?? null,
            suspended: Boolean(a.suspended),
            memory: a.limits?.memory ?? 0,
            disk: a.limits?.disk ?? 0,
        };
    });
}

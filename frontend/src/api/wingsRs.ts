import http from '@/lib/http';

// Wings-RS (Supercharged) admin endpoints, under /api/application/nodes/{id}/wings-rs/.
// The daemon JSON is loosely shaped, so these mappers normalise the many key
// spellings Wings-RS has shipped (ported from V1's admin/nodes/wingsRs.ts).

export interface WingsRsDetection {
    detected: boolean;
    supercharged: boolean;
    wingsType: string;
    wingsVersion: string | null;
    detectedAt: string | null;
}

// Only what /api/system/overview actually returns. Wings-RS 1.0.0-pre.4 emits no
// rust version, build date, uptime or feature list, so those rows were dropped
// rather than left permanently blank.
export interface WingsRsOverview {
    version: string;
    containerType: string | null;
    arch: string;
    kernel: string;
    cpuModel: string | null;
    cpuCount: number | null;
    servers: { total: number; online: number; offline: number } | null;
}

export interface WingsRsStats {
    cpu: { used: number; threads: number; model: string };
    network: { receivedRate: number; sentRate: number };
    memory: { used: number; process: number; total: number };
    disk: { used: number; total: number; readRate: number; writeRate: number };
}

export interface WingsRsLogFile {
    name: string;
    size: number;
    modified: string;
}

export async function detectWingsRs(nodeId: number | string): Promise<WingsRsDetection> {
    const { data } = await http.post(`/api/application/nodes/${nodeId}/wings-rs/detect`);
    return {
        detected: Boolean(data?.detected),
        supercharged: Boolean(data?.supercharged ?? data?.detected),
        wingsType: data?.wings_type ?? 'default',
        wingsVersion: data?.wings_version ?? null,
        detectedAt: data?.detected_at ?? null,
    };
}

export async function getWingsRsOverview(nodeId: number | string): Promise<WingsRsOverview> {
    const { data } = await http.get(`/api/application/nodes/${nodeId}/wings-rs/overview`);
    const servers = data?.servers;

    return {
        version: data?.version ?? 'unknown',
        containerType: data?.container_type ?? data?.os ?? null,
        arch: data?.architecture ?? data?.arch ?? 'unknown',
        kernel: data?.kernel_version ?? data?.kernel ?? 'unknown',
        cpuModel: data?.cpu?.brand ?? data?.cpu?.name ?? null,
        cpuCount: data?.cpu?.cpu_count != null ? Number(data.cpu.cpu_count) : null,
        servers: servers
            ? {
                  total: Number(servers.total ?? 0),
                  online: Number(servers.online ?? 0),
                  offline: Number(servers.offline ?? 0),
              }
            : null,
    };
}

export async function getWingsRsStats(nodeId: number | string): Promise<WingsRsStats> {
    const { data } = await http.get(`/api/application/nodes/${nodeId}/wings-rs/stats`);
    const s = data?.stats ?? data;
    return {
        cpu: {
            used: Number(s?.cpu?.used ?? s?.cpu_used ?? 0),
            threads: Number(s?.cpu?.threads ?? s?.cpu_threads ?? 0),
            model: s?.cpu?.model ?? s?.cpu_model ?? 'Unknown',
        },
        network: {
            receivedRate: Number(s?.network?.receiving_rate ?? s?.network?.received_rate ?? s?.network_receiving_rate ?? 0),
            sentRate: Number(s?.network?.sending_rate ?? s?.network?.sent_rate ?? s?.network_sending_rate ?? 0),
        },
        memory: {
            used: Number(s?.memory?.used ?? s?.memory_used ?? 0),
            process: Number(s?.memory?.used_process ?? s?.memory?.process ?? s?.memory_process ?? 0),
            total: Number(s?.memory?.total ?? s?.memory_total ?? 0),
        },
        disk: {
            used: Number(s?.disk?.used ?? s?.disk_used ?? 0),
            total: Number(s?.disk?.total ?? s?.disk_total ?? 0),
            readRate: Number(s?.disk?.reading_rate ?? s?.disk?.read_rate ?? s?.disk_reading_rate ?? 0),
            writeRate: Number(s?.disk?.writing_rate ?? s?.disk?.write_rate ?? s?.disk_writing_rate ?? 0),
        },
    };
}

export async function getWingsRsLogs(nodeId: number | string): Promise<WingsRsLogFile[]> {
    const { data } = await http.get(`/api/application/nodes/${nodeId}/wings-rs/logs`);
    const items = Array.isArray(data) ? data : (data?.log_files ?? data?.files);
    if (!Array.isArray(items)) return [];
    return items.map((entry: any) => ({
        name: entry?.name ?? entry?.file ?? 'unknown.log',
        size: Number(entry?.size ?? 0),
        modified: entry?.modified ?? entry?.updated_at ?? '',
    }));
}

export async function getWingsRsLogContents(
    nodeId: number | string,
    file: string,
    lines = 200,
): Promise<string[]> {
    const { data } = await http.get(`/api/application/nodes/${nodeId}/wings-rs/logs/${file}`, {
        params: { lines },
    });
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.content)) return data.content;
    if (typeof data?.content === 'string') return data.content.split('\n');
    if (typeof data === 'string') return data.split('\n');
    return [];
}

// POST /api/application/nodes/{id}/wings-rs/upgrade — url must be https, sha256 is 64 hex chars.
export async function upgradeWingsRs(
    nodeId: number | string,
    payload: { url: string; sha256: string },
): Promise<void> {
    await http.post(`/api/application/nodes/${nodeId}/wings-rs/upgrade`, payload);
}

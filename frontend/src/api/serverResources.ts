import http from '@/lib/http';

export type PowerState = 'running' | 'starting' | 'stopping' | 'offline';
export type PowerSignal = 'start' | 'stop' | 'restart' | 'kill';

export interface ServerResources {
    state: PowerState;
    isSuspended: boolean;
    memoryBytes: number;
    cpuPercent: number;
    diskBytes: number;
    networkRxBytes: number;
    networkTxBytes: number;
    uptimeMs: number;
}

// GET /api/client/servers/{id}/resources — live usage (20s server-side cache).
export async function getServerResources(id: string): Promise<ServerResources> {
    const { data } = await http.get(`/api/client/servers/${id}/resources`);
    const a = data.attributes;
    return {
        state: a.current_state,
        isSuspended: a.is_suspended,
        memoryBytes: a.resources.memory_bytes,
        cpuPercent: a.resources.cpu_absolute,
        diskBytes: a.resources.disk_bytes,
        networkRxBytes: a.resources.network_rx_bytes,
        networkTxBytes: a.resources.network_tx_bytes,
        uptimeMs: a.resources.uptime,
    };
}

// POST /api/client/servers/{id}/power
export async function sendPower(id: string, signal: PowerSignal): Promise<void> {
    await http.post(`/api/client/servers/${id}/power`, { signal });
}

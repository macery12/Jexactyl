import http from '@/lib/http';

// Client network/allocation endpoints (/api/client/servers/{uuid}/network/*),
// ported from V1's routes/server/allocations.ts. Allocations are the ip:port
// pairs bound to a server; one is primary, the rest optional (limited by
// feature_limits.allocations).

export interface Allocation {
    id: number;
    ip: string;
    alias: string | null;
    port: number;
    notes: string | null;
    isDefault: boolean;
}

interface FractalAllocation {
    attributes: {
        id: number;
        ip: string;
        ip_alias?: string | null;
        port: number;
        notes?: string | null;
        is_default: boolean;
    };
}

function toAllocation({ attributes: a }: FractalAllocation): Allocation {
    return {
        id: a.id,
        ip: a.ip,
        alias: a.ip_alias ?? null,
        port: a.port,
        notes: a.notes ?? null,
        isDefault: a.is_default,
    };
}

export async function getAllocations(uuid: string): Promise<Allocation[]> {
    const { data } = await http.get(`/api/client/servers/${uuid}/network/allocations`);
    return (data.data ?? []).map(toAllocation);
}

export async function createAllocation(uuid: string): Promise<Allocation> {
    const { data } = await http.post(`/api/client/servers/${uuid}/network/allocations`);
    return toAllocation(data);
}

export async function setPrimaryAllocation(uuid: string, id: number): Promise<Allocation> {
    const { data } = await http.post(`/api/client/servers/${uuid}/network/allocations/${id}/primary`);
    return toAllocation(data);
}

export async function setAllocationNotes(uuid: string, id: number, notes: string | null): Promise<Allocation> {
    const { data } = await http.post(`/api/client/servers/${uuid}/network/allocations/${id}`, { notes });
    return toAllocation(data);
}

export async function deleteAllocation(uuid: string, id: number): Promise<void> {
    await http.delete(`/api/client/servers/${uuid}/network/allocations/${id}`);
}

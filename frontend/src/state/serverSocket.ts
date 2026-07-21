import { create } from 'zustand';
import type { Websocket } from '@/lib/Websocket';
import type { PowerState } from '@/api/serverResources';

export interface LiveStats {
    memoryBytes: number;
    cpuPercent: number;
    diskBytes: number;
    rxBytes: number;
    txBytes: number;
    uptimeMs: number;
}

interface ServerSocketState {
    instance: Websocket | null;
    connected: boolean;
    status: PowerState | null;
    stats: LiveStats | null;
    error: string | null;
    setInstance: (i: Websocket | null) => void;
    setConnected: (c: boolean) => void;
    setStatus: (s: PowerState | null) => void;
    setStats: (s: LiveStats) => void;
    setError: (e: string | null) => void;
    reset: () => void;
}

// Single active-server socket state (only one server page is open at a time),
// mirroring V1's per-server socket store but flattened into one global slice.
export const useServerSocket = create<ServerSocketState>(set => ({
    instance: null,
    connected: false,
    status: null,
    stats: null,
    error: null,
    setInstance: instance => set({ instance }),
    setConnected: connected => set({ connected }),
    setStatus: status => set({ status }),
    setStats: stats => set({ stats }),
    setError: error => set({ error }),
    reset: () => set({ instance: null, connected: false, status: null, stats: null, error: null }),
}));

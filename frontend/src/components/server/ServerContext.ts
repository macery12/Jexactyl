import { createContext, useContext } from 'react';
import type { ServerDetail } from '@/api/servers';

// Shares the loaded server detail across the server layout, header, and widgets
// without re-fetching. Provided by ServerLayout once getServer() resolves.
export const ServerContext = createContext<ServerDetail | null>(null);

export function useServer(): ServerDetail {
    const server = useContext(ServerContext);
    if (!server) throw new Error('useServer must be used within a ServerContext provider');
    return server;
}

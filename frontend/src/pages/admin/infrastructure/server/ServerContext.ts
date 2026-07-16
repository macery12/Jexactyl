import { createContext, useContext } from 'react';
import type { ServerView } from '@/api/adminServers';

export const ServerContext = createContext<ServerView | null>(null);

export function useServerView(): ServerView {
    const server = useContext(ServerContext);
    if (!server) throw new Error('useServerView must be used within a ServerContext provider');
    return server;
}

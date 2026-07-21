import { useEffect } from 'react';
import { Websocket, SocketEvent, SocketRequest } from '@/lib/Websocket';
import { getWebsocketCredentials } from '@/api/websocket';
import { useServerSocket } from '@/state/serverSocket';
import type { PowerState } from '@/api/serverResources';

const reconnectErrors = ['jwt: exp claim is invalid', 'jwt: created too far in past (denylist)'];

// Opens (and owns the lifecycle of) the daemon websocket for a server. Pushes
// status + stats into the serverSocket store; the console widget subscribes to
// raw output events directly off the `instance`. Ported from V1 WebsocketHandler.
export function useServerSocketConnection(uuid: string | undefined): void {
    const { setInstance, setConnected, setStatus, setStats, setError, reset } = useServerSocket();

    useEffect(() => {
        if (!uuid) return;

        let updatingToken = false;
        const socket = new Websocket();

        const refreshToken = () => {
            if (updatingToken) return;
            updatingToken = true;
            getWebsocketCredentials(uuid)
                .then(({ token }) => socket.setToken(token, true))
                .catch(err => console.error(err))
                .finally(() => {
                    updatingToken = false;
                });
        };

        socket.on(SocketEvent.AUTH_SUCCESS, () => {
            setConnected(true);
            setError(null);
            // Stats stream for the live-stats widget. Console history (`send logs`)
            // is requested by the console widget itself, so it controls timing.
            socket.send(SocketRequest.SEND_STATS);
        });
        socket.on('SOCKET_CLOSE', () => setConnected(false));
        socket.on('SOCKET_ERROR', () => {
            setConnected(false);
            setError('connecting');
        });
        socket.on('SOCKET_CONNECT_ERROR', () =>
            setError('Failed to connect to the server after multiple attempts. Try refreshing the page.'),
        );

        socket.on(SocketEvent.STATUS, status => setStatus(status as PowerState));
        socket.on(SocketEvent.STATS, raw => {
            try {
                const s = JSON.parse(raw as string);
                setStats({
                    memoryBytes: s.memory_bytes,
                    cpuPercent: s.cpu_absolute,
                    diskBytes: s.disk_bytes,
                    rxBytes: s.network?.rx_bytes ?? 0,
                    txBytes: s.network?.tx_bytes ?? 0,
                    uptimeMs: s.uptime ?? 0,
                });
            } catch {
                /* ignore malformed stat frames */
            }
        });

        socket.on(SocketEvent.TOKEN_EXPIRING, refreshToken);
        socket.on(SocketEvent.TOKEN_EXPIRED, refreshToken);
        socket.on(SocketEvent.JWT_ERROR, err => {
            setConnected(false);
            const message = String(err ?? '').toLowerCase();
            if (reconnectErrors.some(v => message.includes(v))) {
                refreshToken();
            } else {
                setError('Could not validate the websocket credentials. Please refresh the page.');
            }
        });
        socket.on(SocketEvent.DAEMON_ERROR, message =>
            console.warn('Daemon socket error:', message),
        );

        setInstance(socket);

        getWebsocketCredentials(uuid)
            .then(({ token, socket: url }) => socket.setToken(token).connect(url))
            .catch(err => {
                console.error(err);
                setError('Could not retrieve websocket credentials for this server.');
            });

        return () => {
            socket.close();
            reset();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [uuid]);
}

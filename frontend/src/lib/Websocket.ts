import Sockette from 'sockette';
import mitt, { type Emitter } from 'mitt';

// Wings websocket events we care about. Daemon emits `{ event, args }` frames;
// we re-broadcast them through mitt so widgets can subscribe individually.
// Ported from V1 resources/scripts/plugins/Websocket.ts (logic only, no easy-peasy).

type Events = Record<string, unknown>;

export class Websocket {
    private socket: Sockette | null = null;
    private url: string | null = null;
    private token = '';
    private readonly bus: Emitter<Events> = mitt<Events>();

    connect(url: string): this {
        this.url = url;

        this.socket = new Sockette(url, {
            timeout: 1000,
            maxAttempts: 20,
            onmessage: e => {
                try {
                    const { event, args } = JSON.parse(e.data);
                    this.bus.emit(event, args ? args[0] : undefined);
                } catch (ex) {
                    console.warn('Failed to parse incoming websocket message.', ex);
                }
            },
            onopen: () => {
                this.bus.emit('SOCKET_OPEN');
                this.authenticate();
            },
            onreconnect: evt => {
                // Wings returns 4409 (suspended) / 4400 (reserved). Sockette always
                // reconnects for codes other than 1000/1001/1003, so abort here.
                const code = (evt as CloseEvent).code;
                if (code === 4409 || code === 4400) {
                    this.close(1000);
                } else {
                    this.bus.emit('SOCKET_RECONNECT');
                }
            },
            onclose: () => this.bus.emit('SOCKET_CLOSE'),
            onerror: error => this.bus.emit('SOCKET_ERROR', error),
            onmaximum: () => this.bus.emit('SOCKET_CONNECT_ERROR'),
        });

        return this;
    }

    setToken(token: string, isUpdate = false): this {
        this.token = token;
        if (isUpdate) this.authenticate();
        return this;
    }

    authenticate(): void {
        if (this.url && this.token) this.send('auth', this.token);
    }

    close(code?: number, reason?: string): void {
        this.url = null;
        this.token = '';
        this.socket?.close(code, reason);
        this.bus.all.clear();
    }

    send(event: string, payload?: string | string[]): void {
        this.socket?.json({ event, args: Array.isArray(payload) ? payload : [payload] });
    }

    on(event: string, handler: (arg?: unknown) => void): void {
        this.bus.on(event, handler as (arg: unknown) => void);
    }

    off(event: string, handler: (arg?: unknown) => void): void {
        this.bus.off(event, handler as (arg: unknown) => void);
    }
}

// Daemon → client event names (mirrors V1 components/server/events.ts).
export const SocketEvent = {
    DAEMON_MESSAGE: 'daemon message',
    DAEMON_ERROR: 'daemon error',
    INSTALL_OUTPUT: 'install output',
    INSTALL_STARTED: 'install started',
    INSTALL_COMPLETED: 'install completed',
    CONSOLE_OUTPUT: 'console output',
    STATUS: 'status',
    STATS: 'stats',
    TRANSFER_LOGS: 'transfer logs',
    TRANSFER_STATUS: 'transfer status',
    BACKUP_COMPLETED: 'backup completed',
    AUTH_SUCCESS: 'auth success',
    TOKEN_EXPIRING: 'token expiring',
    TOKEN_EXPIRED: 'token expired',
    JWT_ERROR: 'jwt error',
} as const;

export const SocketRequest = {
    SEND_LOGS: 'send logs',
    SEND_STATS: 'send stats',
    SET_STATE: 'set state',
    SEND_COMMAND: 'send command',
} as const;

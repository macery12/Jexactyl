import { m } from '@/i18n';
import { useState } from 'react';
import { Power, Play, RotateCcw, Square, Zap } from 'lucide-react';
import { Panel } from './Panel';
import { useServer } from '@/components/server/ServerContext';
import { useServerSocket } from '@/state/serverSocket';
import { SocketRequest } from '@/lib/Websocket';
import { can } from '@/lib/can';
import { cn } from '@/lib/cn';

type Action = 'start' | 'restart' | 'stop' | 'kill';

export function PowerPanel() {
    const server = useServer();
    const instance = useServerSocket(s => s.instance);
    const status = useServerSocket(s => s.status);
    const connected = useServerSocket(s => s.connected);
    const [confirmKill, setConfirmKill] = useState(false);

    const allowed = can(server.permissions, 'control.start');
    const send = (action: Action) => instance?.send(SocketRequest.SET_STATE, action);
    const isOffline = status === 'offline' || status === null;
    const ready = connected && allowed && !server.isSuspended;

    const btn =
        'flex items-center justify-center gap-2 rounded-sm border px-3 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors disabled:cursor-not-allowed disabled:opacity-30';

    return (
        <Panel title={m['server.power.title']()} icon={Power}>
            <div className="flex flex-col gap-2">
                <button
                    onClick={() => send('start')}
                    disabled={!ready || !isOffline}
                    className={cn(btn, 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)] hover:bg-[var(--color-accent)]/20')}
                >
                    <Play className="h-3.5 w-3.5" /> {m['common.power.start']()}
                </button>
                <div className="grid grid-cols-2 gap-2">
                    <button
                        onClick={() => send('restart')}
                        disabled={!ready || isOffline}
                        className={cn(btn, 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 text-[var(--color-warning)] hover:bg-[var(--color-warning)]/20')}
                    >
                        <RotateCcw className="h-3.5 w-3.5" /> {m['common.power.restart']()}
                    </button>
                    <button
                        onClick={() => send('stop')}
                        disabled={!ready || isOffline}
                        className={cn(btn, 'border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 text-[var(--color-danger)] hover:bg-[var(--color-danger)]/20')}
                    >
                        <Square className="h-3.5 w-3.5" /> {m['common.power.stop']()}
                    </button>
                </div>
                <button
                    onClick={() => {
                        if (confirmKill) {
                            send('kill');
                            setConfirmKill(false);
                        } else {
                            setConfirmKill(true);
                            setTimeout(() => setConfirmKill(false), 3000);
                        }
                    }}
                    disabled={!ready || isOffline}
                    className={cn(
                        btn,
                        confirmKill
                            ? 'border-[var(--color-danger)] bg-[var(--color-danger)]/25 text-[var(--color-danger)]'
                            : 'border-[var(--color-border-strong)] text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)]',
                    )}
                >
                    <Zap className="h-3.5 w-3.5" /> {confirmKill ? m['server.power.confirmKill']() : m['server.power.forceKill']()}
                </button>
            </div>
        </Panel>
    );
}

import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Copy, Check, Play, RotateCcw, Shield, Square } from 'lucide-react';
import { useServer } from './ServerContext';
import { useServerSocket } from '@/state/serverSocket';
import { SocketRequest } from '@/lib/Websocket';
import { can } from '@/lib/can';
import { cn } from '@/lib/cn';
import { m, td } from '@/i18n';
import { useAdminHeld } from '@/layouts/heldPermissions';

const stateMeta: Record<string, { label: string; dot: string }> = {
    running: { label: 'Running', dot: 'bg-[var(--color-accent)]' },
    starting: { label: 'Starting', dot: 'bg-[var(--color-warning)] animate-pulse' },
    stopping: { label: 'Stopping', dot: 'bg-[var(--color-warning)] animate-pulse' },
    offline: { label: 'Offline', dot: 'bg-[var(--color-ink-faint)]' },
};

export function ServerHeader() {
    const server = useServer();
    const held = useAdminHeld();
    const canViewAsAdmin = can(held, 'servers.read');
    const status = useServerSocket(s => s.status);
    const instance = useServerSocket(s => s.instance);
    const connected = useServerSocket(s => s.connected);
    const [copied, setCopied] = useState(false);

    const suspended = server.isSuspended;
    const installing = server.isInstalling;
    const state = suspended || installing ? 'offline' : (status ?? 'offline');
    const meta = stateMeta[state] ?? stateMeta.offline!;

    const primary = server.allocations.find(a => a.isDefault) ?? server.allocations[0];
    const address = primary ? `${primary.alias || primary.ip}:${primary.port}` : null;

    const copyAddress = () => {
        if (!address) return;
        navigator.clipboard?.writeText(address).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    };

    const canControl = can(server.permissions, 'control.start');
    const send = (action: 'start' | 'restart' | 'stop') => instance?.send(SocketRequest.SET_STATE, action);
    const isOffline = state === 'offline';

    let statusLabel = td(`common.states.${state}`, meta.label);
    let statusDot = meta.dot;
    if (suspended) {
        statusLabel = td('common.states.suspended');
        statusDot = 'bg-[var(--color-danger)]';
    } else if (installing) {
        statusLabel = td('common.states.installing');
        statusDot = 'bg-[var(--color-warning)] animate-pulse';
    } else if (!connected) {
        statusLabel = td('server.header.connecting');
    }

    return (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
                <Link
                    to="/"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border-strong)] text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-2)]"
                    title={td('server.header.back')}
                >
                    <ChevronLeft className="h-4 w-4" />
                </Link>
                <div className="min-w-0">
                    <div className="flex items-center gap-2.5">
                        <h1 className="truncate text-xl font-semibold tracking-tight text-[var(--color-ink)]">
                            {server.name}
                        </h1>
                        <span className="flex shrink-0 items-center gap-1.5 rounded-sm border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-[var(--color-ink-muted)]">
                            <span className={cn('h-2 w-2 rounded-full', statusDot)} />
                            {statusLabel}
                        </span>
                    </div>
                    {address && (
                        <button
                            onClick={copyAddress}
                            className="group mt-0.5 flex items-center gap-1.5 font-mono text-xs text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
                        >
                            {address}
                            {copied ? (
                                <Check className="h-3 w-3 text-[var(--color-accent)]" />
                            ) : (
                                <Copy className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
                            )}
                        </button>
                    )}
                </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
                {/* Admin escape hatch back to this server's admin page. The admin area
                    routes by numeric primary key, not the client identifier. */}
                {canViewAsAdmin && (
                    <Link
                        to={`/admin/infrastructure/servers/${server.internalId}`}
                        className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-[var(--color-border-strong)] px-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                    >
                        <Shield className="h-3.5 w-3.5" /> {m['server.header.viewAsAdmin']()}
                    </Link>
                )}
                {canControl && !suspended && (
                    <>
                    <button
                        onClick={() => send('start')}
                        disabled={!isOffline || !connected}
                        className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                        <Play className="h-3.5 w-3.5" /> Start
                    </button>
                    <button
                        onClick={() => send('restart')}
                        disabled={isOffline || !connected}
                        className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-warning)] transition-colors hover:bg-[var(--color-warning)]/20 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                        <RotateCcw className="h-3.5 w-3.5" /> Restart
                    </button>
                    <button
                        onClick={() => send('stop')}
                        disabled={isOffline || !connected}
                        className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 text-xs font-semibold uppercase tracking-wider text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger)]/20 disabled:cursor-not-allowed disabled:opacity-30"
                    >
                        <Square className="h-3.5 w-3.5" /> Stop
                    </button>
                    </>
                )}
            </div>
        </div>
    );
}

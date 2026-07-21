import { m, td } from '@/i18n';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Cpu, MemoryStick, HardDrive, Play, Square, RotateCcw, Clock, AlertTriangle } from 'lucide-react';
import { Meter } from '@/components/ui/Meter';
import { formatBytes, formatMib, mibToBytes, formatUptime } from '@/lib/format';
import { sendPower, type PowerSignal, type ServerResources } from '@/api/serverResources';
import type { ServerListItem } from '@/api/servers';
import { cn } from '@/lib/cn';

// state → status-dot styling. Label text comes from common:states.* at render.
const stateDot: Record<string, string> = {
    running: 'bg-[var(--color-accent)]',
    starting: 'bg-[var(--color-warning)] animate-pulse',
    stopping: 'bg-[var(--color-warning)] animate-pulse',
    offline: 'bg-[var(--color-ink-faint)]',
};

function PowerButton({
    icon: Icon,
    title,
    tone,
    disabled,
    onClick,
}: {
    icon: typeof Play;
    title: string;
    tone: string;
    disabled: boolean;
    onClick: (e: React.MouseEvent) => void;
}) {
    return (
        <button
            title={title}
            disabled={disabled}
            onClick={onClick}
            className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--color-border-strong)] transition-colors disabled:opacity-30',
                tone,
            )}
        >
            <Icon className="h-3.5 w-3.5" />
        </button>
    );
}

export function LiveServerCard({
    server,
    resources,
    pending,
}: {
    server: ServerListItem;
    resources?: ServerResources;
    pending: boolean;
}) {
    const qc = useQueryClient();
    const suspended = server.status === 'suspended' || resources?.isSuspended;
    const state = suspended ? 'offline' : (resources?.state ?? 'offline');
    const dot = stateDot[state] ?? stateDot.offline!;
    const stateLabel = td(`common.states.${state === 'starting' || state === 'stopping' || state === 'running' ? state : 'offline'}`);

    const power = useMutation({
        mutationFn: (signal: PowerSignal) => sendPower(server.id, signal),
        onSuccess: () => {
            setTimeout(() => qc.invalidateQueries({ queryKey: ['resources', server.id] }), 800);
        },
    });

    const act = (signal: PowerSignal) => (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        power.mutate(signal);
    };

    const memTotal = server.limits.memory > 0 ? mibToBytes(server.limits.memory) : 0;
    const diskTotal = server.limits.disk > 0 ? mibToBytes(server.limits.disk) : 0;
    const cpuLimit = server.limits.cpu;

    const isRunning = state === 'running';
    const isOffline = state === 'offline';

    return (
        <Link
            to={`/server/${server.id}`}
            className="group flex flex-col gap-4 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-5 transition-colors hover:border-[var(--brand)]/50"
        >
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="truncate font-semibold text-[var(--color-ink)]">{server.name}</h3>
                    <p className="truncate text-xs text-[var(--color-ink-faint)]">{server.node}</p>
                </div>
                <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--color-surface-2)] px-2.5 py-1 text-xs text-[var(--color-ink-muted)]">
                    <span className={cn('h-2 w-2 rounded-full', suspended ? 'bg-[var(--color-danger)]' : dot)} />
                    {suspended ? m['common.states.suspended']() : stateLabel}
                </span>
            </div>

            <div className="flex flex-col gap-2.5">
                <Meter
                    icon={Cpu}
                    label={m['common.metrics.cpu']()}
                    value={resources ? `${resources.cpuPercent.toFixed(0)}%` : '—'}
                    percent={
                        resources ? (cpuLimit > 0 ? (resources.cpuPercent / cpuLimit) * 100 : resources.cpuPercent) : null
                    }
                />
                <Meter
                    icon={MemoryStick}
                    label={m['common.metrics.memory']()}
                    value={resources ? `${formatBytes(resources.memoryBytes)} / ${formatMib(server.limits.memory)}` : '—'}
                    percent={resources && memTotal > 0 ? (resources.memoryBytes / memTotal) * 100 : null}
                />
                <Meter
                    icon={HardDrive}
                    label={m['common.metrics.disk']()}
                    value={resources ? `${formatBytes(resources.diskBytes)} / ${formatMib(server.limits.disk)}` : '—'}
                    percent={resources && diskTotal > 0 ? (resources.diskBytes / diskTotal) * 100 : null}
                />
            </div>

            {suspended && (
                <div className="flex items-center gap-1.5 text-xs text-[var(--color-danger)]">
                    <AlertTriangle className="h-3.5 w-3.5" /> {m['dashboard.serverSuspended']()}
                </div>
            )}

            <div className="mt-auto flex items-center justify-between border-t border-[var(--color-border)] pt-3">
                <span className="flex items-center gap-1.5 text-xs text-[var(--color-ink-muted)]">
                    <Clock className="h-3.5 w-3.5" />
                    {resources && isRunning ? formatUptime(resources.uptimeMs) : pending ? '…' : m['dashboard.offlineShort']()}
                </span>
                <div className="flex items-center gap-1.5">
                    <PowerButton
                        icon={Play}
                        title={m['common.power.start']()}
                        tone="text-[var(--color-accent)] hover:bg-[var(--color-accent)]/10"
                        disabled={!!suspended || !isOffline || power.isPending}
                        onClick={act('start')}
                    />
                    <PowerButton
                        icon={RotateCcw}
                        title={m['common.power.restart']()}
                        tone="text-[var(--color-warning)] hover:bg-[var(--color-warning)]/10"
                        disabled={!!suspended || !isRunning || power.isPending}
                        onClick={act('restart')}
                    />
                    <PowerButton
                        icon={Square}
                        title={m['common.power.stop']()}
                        tone="text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10"
                        disabled={!!suspended || !isRunning || power.isPending}
                        onClick={act('stop')}
                    />
                </div>
            </div>
        </Link>
    );
}

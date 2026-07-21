import { m } from '@/i18n';
import { useServerSocket } from '@/state/serverSocket';
import { formatBytes, mibToBytes, formatUptime } from '@/lib/format';
import { useServer } from '@/components/server/ServerContext';
import { cn } from '@/lib/cn';

function Cell({
    label,
    value,
    sub,
    percent,
}: {
    label: string;
    value: string;
    sub?: string;
    percent?: number | null;
}) {
    const p = percent == null ? null : Math.max(0, Math.min(100, percent));
    const tone =
        p == null
            ? 'bg-[var(--color-ink-faint)]'
            : p >= 90
              ? 'bg-[var(--color-danger)]'
              : p >= 70
                ? 'bg-[var(--color-warning)]'
                : 'bg-[var(--color-accent)]';
    return (
        <div className="flex flex-col gap-1.5 px-4 py-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">
                {label}
            </span>
            <span className="font-mono text-lg leading-none tabular-nums text-[var(--color-ink)]">{value}</span>
            {percent !== undefined ? (
                <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                    <div className={cn('h-full transition-all duration-500', tone)} style={{ width: `${p ?? 0}%` }} />
                </div>
            ) : (
                <span className="font-mono text-[11px] tabular-nums text-[var(--color-ink-faint)]">{sub ?? ' '}</span>
            )}
        </div>
    );
}

export function StatStrip() {
    const server = useServer();
    const stats = useServerSocket(s => s.stats);
    const status = useServerSocket(s => s.status);
    const offline = status === 'offline' || status === null;

    const cpuLimit = server.limits.cpu;
    const memTotal = server.limits.memory > 0 ? mibToBytes(server.limits.memory) : 0;
    const diskTotal = server.limits.disk > 0 ? mibToBytes(server.limits.disk) : 0;

    return (
        <div className="grid grid-cols-2 divide-x divide-y divide-[var(--color-border)] overflow-hidden rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70 sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-6">
            <Cell
                label={m['common.metrics.uptime']()}
                value={stats && !offline && stats.uptimeMs > 0 ? formatUptime(stats.uptimeMs) : '—'}
                sub={offline ? m['server.stats.offline']() : m['server.stats.live']()}
            />
            <Cell
                label={m['common.metrics.cpu']()}
                value={stats && !offline ? `${stats.cpuPercent.toFixed(1)}%` : '—'}
                percent={stats && !offline ? (cpuLimit > 0 ? (stats.cpuPercent / cpuLimit) * 100 : stats.cpuPercent) : null}
            />
            <Cell
                label={m['common.metrics.memory']()}
                value={stats && !offline ? formatBytes(stats.memoryBytes) : '—'}
                percent={stats && !offline && memTotal > 0 ? (stats.memoryBytes / memTotal) * 100 : null}
            />
            <Cell
                label={m['common.metrics.disk']()}
                value={stats ? formatBytes(stats.diskBytes) : '—'}
                percent={stats && diskTotal > 0 ? (stats.diskBytes / diskTotal) * 100 : null}
            />
            <Cell label={m['server.stats.netIn']()} value={stats && !offline ? formatBytes(stats.rxBytes) : '—'} sub={m['server.stats.received']()} />
            <Cell label={m['server.stats.netOut']()} value={stats && !offline ? formatBytes(stats.txBytes) : '—'} sub={m['server.stats.transmitted']()} />
        </div>
    );
}

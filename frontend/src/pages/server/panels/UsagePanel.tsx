import { m } from '@/i18n';
import { useEffect, useRef, useState } from 'react';
import { Activity as ActivityIcon } from 'lucide-react';
import { Panel } from './Panel';
import { useServer } from '@/components/server/ServerContext';
import { useServerSocket } from '@/state/serverSocket';
import { formatBytes, formatMib, mibToBytes } from '@/lib/format';
import { cn } from '@/lib/cn';

const HISTORY = 48;

function Sparkline({ data, max }: { data: number[]; max: number }) {
    if (data.length < 2) return <div className="h-14" />;
    const ceil = Math.max(max, ...data, 1);
    const step = 100 / (HISTORY - 1);
    const line = data.map((v, i) => `${(i * step).toFixed(2)},${(100 - (v / ceil) * 100).toFixed(2)}`).join(' ');
    const area = `0,100 ${line} ${((data.length - 1) * step).toFixed(2)},100`;
    return (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-14 w-full">
            <polygon points={area} fill="color-mix(in oklab, var(--brand) 18%, transparent)" />
            <polyline
                points={line}
                fill="none"
                stroke="var(--brand)"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
            />
        </svg>
    );
}

function Bar({ label, value, percent }: { label: string; value: string; percent: number | null }) {
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
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">{label}</span>
                <span className="font-mono tabular-nums text-[var(--color-ink-muted)]">{value}</span>
            </div>
            <div className="h-1 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                <div className={cn('h-full transition-all duration-500', tone)} style={{ width: `${p ?? 0}%` }} />
            </div>
        </div>
    );
}

export function UsagePanel() {
    const server = useServer();
    const stats = useServerSocket(s => s.stats);
    const status = useServerSocket(s => s.status);
    const [cpuHistory, setCpuHistory] = useState<number[]>([]);
    const lastUptime = useRef(0);

    useEffect(() => {
        if (!stats) return;
        if (stats.uptimeMs !== lastUptime.current) {
            lastUptime.current = stats.uptimeMs;
            setCpuHistory(prev => [...prev, stats.cpuPercent].slice(-HISTORY));
        }
    }, [stats]);

    const offline = status === 'offline' || status === null;
    const cpuLimit = server.limits.cpu;
    const memTotal = server.limits.memory > 0 ? mibToBytes(server.limits.memory) : 0;
    const diskTotal = server.limits.disk > 0 ? mibToBytes(server.limits.disk) : 0;

    return (
        <Panel
            title={m['server.usage.title']()}
            icon={ActivityIcon}
            right={
                <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)]">
                    {m['server.usage.cpuTrend']()}
                </span>
            }
        >
            <div className="flex flex-col gap-3">
                <Sparkline data={offline ? [] : cpuHistory} max={cpuLimit > 0 ? cpuLimit : 100} />
                <Bar
                    label={m['common.metrics.cpu']()}
                    value={stats && !offline ? `${stats.cpuPercent.toFixed(1)}%` : '—'}
                    percent={stats && !offline ? (cpuLimit > 0 ? (stats.cpuPercent / cpuLimit) * 100 : stats.cpuPercent) : null}
                />
                <Bar
                    label={m['common.metrics.memory']()}
                    value={stats && !offline ? `${formatBytes(stats.memoryBytes)} / ${formatMib(server.limits.memory)}` : '—'}
                    percent={stats && !offline && memTotal > 0 ? (stats.memoryBytes / memTotal) * 100 : null}
                />
                <Bar
                    label={m['common.metrics.disk']()}
                    value={stats ? `${formatBytes(stats.diskBytes)} / ${formatMib(server.limits.disk)}` : '—'}
                    percent={stats && diskTotal > 0 ? (stats.diskBytes / diskTotal) * 100 : null}
                />
            </div>
        </Panel>
    );
}

import { m } from '@/i18n/messages';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Server, Activity, MemoryStick, LifeBuoy, AlertTriangle } from 'lucide-react';
import { formatBytes, formatMib } from '@/lib/format';
import { useFlags } from '@/state/flags';
import { getTickets } from '@/api/tickets';
import { cn } from '@/lib/cn';
import type { ServerListItem } from '@/api/servers';

type Tone = 'brand' | 'warning';

function Tile({
    icon: Icon,
    label,
    value,
    sub,
    to,
    tone = 'brand',
}: {
    icon: typeof Server;
    label: string;
    value: string;
    sub?: string;
    to?: string;
    tone?: Tone;
}) {
    const body = (
        <>
            <div className="flex items-center justify-between gap-2">
                <p className="truncate text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-ink-faint)]">
                    {label}
                </p>
                <Icon
                    className={cn(
                        'h-4 w-4 shrink-0',
                        tone === 'warning' ? 'text-[var(--color-warning)]' : 'text-[var(--color-ink-faint)]',
                    )}
                />
            </div>
            <p
                className={cn(
                    'mt-1.5 font-mono text-2xl font-semibold tabular-nums',
                    tone === 'warning' ? 'text-[var(--color-warning)]' : 'text-[var(--color-ink)]',
                )}
            >
                {value}
                {sub && (
                    <span className="ml-1 text-sm font-normal text-[var(--color-ink-faint)]">{sub}</span>
                )}
            </p>
        </>
    );

    const className = cn(
        'flex flex-col rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 py-3.5',
        to && 'transition-colors hover:bg-[var(--color-surface-2)]',
    );

    return to ? (
        <Link to={to} className={className}>
            {body}
        </Link>
    ) : (
        <div className={className}>{body}</div>
    );
}

export function StatTiles({
    servers,
    running,
    suspended,
    memUsedBytes,
}: {
    servers: ServerListItem[];
    running: number | null;
    suspended: number | null;
    memUsedBytes: number | null;
}) {
    const flags = useFlags(s => s.everest);
    const ticketsEnabled = flags?.tickets.enabled ?? false;

    const { data: tickets } = useQuery({
        queryKey: ['account', 'tickets'],
        queryFn: getTickets,
        enabled: ticketsEnabled,
    });
    const openTickets = tickets ? tickets.filter(t => t.status !== 'resolved').length : null;

    const totalMem = servers.reduce((sum, s) => sum + s.limits.memory, 0);

    return (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile icon={Server} label={m['dashboard.stats.servers']()} value={String(servers.length)} />
            <Tile
                icon={Activity}
                label={m['dashboard.stats.running']()}
                value={running === null ? '—' : String(running)}
                sub={running === null ? '' : `/ ${servers.length}`}
            />
            <Tile
                icon={AlertTriangle}
                label={m['dashboard.stats.attention']()}
                value={suspended === null ? '—' : String(suspended)}
                tone={suspended && suspended > 0 ? 'warning' : 'brand'}
            />
            {ticketsEnabled ? (
                <Tile
                    icon={LifeBuoy}
                    label={m['dashboard.stats.openTickets']()}
                    value={openTickets === null ? '—' : String(openTickets)}
                    to="/tickets"
                />
            ) : (
                <Tile
                    icon={MemoryStick}
                    label={m['dashboard.stats.memoryUsed']()}
                    value={memUsedBytes === null ? '—' : formatBytes(memUsedBytes)}
                    sub={totalMem === 0 ? '/ ∞' : `/ ${formatMib(totalMem)}`}
                />
            )}
        </div>
    );
}

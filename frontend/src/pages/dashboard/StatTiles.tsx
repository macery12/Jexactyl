import { m } from '@/i18n';
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
            <div
                className={cn(
                    'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
                    tone === 'warning' ? 'bg-[var(--color-warning)]/10' : 'bg-[var(--color-surface-2)]',
                )}
            >
                <Icon className={cn('h-5 w-5', tone === 'warning' ? 'text-[var(--color-warning)]' : 'text-[var(--brand)]')} />
            </div>
            <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-[var(--color-ink-faint)]">{label}</p>
                <p className="text-xl font-semibold text-[var(--color-ink)]">
                    {value}
                    {sub && <span className="ml-1 text-sm font-normal text-[var(--color-ink-muted)]">{sub}</span>}
                </p>
            </div>
        </>
    );

    const className = cn(
        'flex items-center gap-4 rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70 p-5',
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
                    to="/account/tickets"
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

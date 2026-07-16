import { m, td } from '@/i18n';
import { useQuery } from '@tanstack/react-query';
import { Layers } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { useNode } from '../NodeContext';
import { getNodeServers } from '@/api/nodes';
import { formatMib } from '@/lib/format';
import { Spinner } from '@/components/ui/Spinner';
import { Badge } from '../NodeBadges';

const stateTone: Record<string, 'accent' | 'warning' | 'danger' | 'muted'> = {
    running: 'accent',
    starting: 'warning',
    stopping: 'warning',
    offline: 'muted',
};

export function NodeServersTab() {
    const node = useNode();
    const { data: servers, isLoading } = useQuery({
        queryKey: ['admin', 'node-servers', node.id],
        queryFn: () => getNodeServers(node.id),
    });

    return (
        <Panel
            title={m['admin.nodes.serversTab.title']()}
            icon={Layers}
            right={
                <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)]">
                    {m['admin.nodes.serversTab.total']({ count: servers?.length ?? 0 })}
                </span>
            }
            bodyClassName="max-h-[32rem] overflow-y-auto"
        >
            {isLoading ? (
                <div className="flex justify-center py-10">
                    <Spinner className="h-6 w-6" />
                </div>
            ) : !servers || servers.length === 0 ? (
                <p className="py-6 text-sm text-[var(--color-ink-faint)]">{m['admin.nodes.serversTab.none']()}</p>
            ) : (
                <div className="flex flex-col">
                    {servers.map(s => (
                        <div
                            key={s.id}
                            className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] py-2.5 last:border-0"
                        >
                            <div className="flex min-w-0 items-center gap-2.5">
                                <Badge tone={s.suspended ? 'danger' : (stateTone[s.status ?? 'offline'] ?? 'muted')}>
                                    {s.suspended
                                        ? m['common.states.suspended']()
                                        : td(`common.states.${s.status ?? 'offline'}`, s.status ?? 'offline')}
                                </Badge>
                                <span className="truncate text-sm text-[var(--color-ink)]">{s.name}</span>
                            </div>
                            <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--color-ink-faint)]">
                                {formatMib(s.memory)} · {formatMib(s.disk)}
                            </span>
                        </div>
                    ))}
                </div>
            )}
        </Panel>
    );
}

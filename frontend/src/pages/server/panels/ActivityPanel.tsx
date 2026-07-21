import { m } from '@/i18n';
import { useQuery } from '@tanstack/react-query';
import { ScrollText } from 'lucide-react';
import { Panel } from './Panel';
import { useServer } from '@/components/server/ServerContext';
import { getServerActivity } from '@/api/serverActivity';
import { timeAgo } from '@/lib/format';

function prettyEvent(event: string): string {
    const tail = event.split(':').pop() ?? event;
    return tail.replace(/[._-]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function ActivityPanel() {
    const server = useServer();
    const { data: entries, isLoading } = useQuery({
        queryKey: ['server-activity', server.id],
        queryFn: () => getServerActivity(server.id),
    });

    return (
        <Panel title={m['server.activity.title']()} icon={ScrollText} bodyClassName="max-h-72 overflow-y-auto">
            {isLoading && <p className="text-sm text-[var(--color-ink-faint)]">{m['common.states.loading']()}</p>}
            {!isLoading && (!entries || entries.length === 0) && (
                <p className="text-sm text-[var(--color-ink-faint)]">{m['server.activity.empty']()}</p>
            )}
            <div className="flex flex-col">
                {entries?.map((entry, i) => (
                    <div
                        key={entry.id}
                        className="flex items-start gap-3 py-2"
                        style={{ borderTop: i === 0 ? undefined : '1px solid var(--color-border)' }}
                    >
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-sm text-[var(--color-ink)]">
                                {entry.description || prettyEvent(entry.event)}
                            </p>
                            <p className="font-mono text-[11px] tabular-nums text-[var(--color-ink-faint)]">
                                {timeAgo(entry.timestamp)}
                                {entry.ip ? ` · ${entry.ip}` : ''}
                            </p>
                        </div>
                    </div>
                ))}
            </div>
        </Panel>
    );
}

import { m } from '@/i18n';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, History } from 'lucide-react';
import { Link } from 'react-router-dom';
import { getAccountActivity, type ActivityEntry } from '@/api/activity';
import { timeAgo } from '@/lib/format';
import { ActivityDetailsModal, hasActivityDetails } from '@/pages/account/activity/ActivityDetailsModal';

// Turn an event key like 'auth:fail' or 'user:account.email-changed' into prose.
function prettyEvent(event: string): string {
    const tail = event.split(':').pop() ?? event;
    return tail
        .replace(/[._-]/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
}

function FeedRow({ entry, first, onInspect }: { entry: ActivityEntry; first: boolean; onInspect: (entry: ActivityEntry) => void }) {
    const inspectable = hasActivityDetails(entry);
    const inner = (
        <>
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
            <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-[var(--color-ink)]">{entry.description || prettyEvent(entry.event)}</p>
                <p className="text-xs text-[var(--color-ink-faint)]">
                    {timeAgo(entry.timestamp)}
                    {entry.ip ? ` · ${entry.ip}` : ''}
                </p>
            </div>
        </>
    );
    const border = { borderTop: first ? undefined : '1px solid var(--color-border)' };

    if (!inspectable) {
        return (
            <div className="flex items-start gap-3 px-3 py-2.5" style={border}>
                {inner}
            </div>
        );
    }

    return (
        <button
            type="button"
            onClick={() => onInspect(entry)}
            title={m['activity.details.inspect']()}
            className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-surface-2)]"
            style={border}
        >
            {inner}
        </button>
    );
}

export function ActivityFeed() {
    const { data: entries, isLoading } = useQuery({
        queryKey: ['account-activity'],
        queryFn: getAccountActivity,
    });
    const [inspecting, setInspecting] = useState<ActivityEntry | null>(null);

    return (
        <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink-muted)]">
                    <History className="h-4 w-4" /> {m['dashboard.recentActivity']()}
                </h2>
                <Link
                    to="/activity"
                    className="flex items-center gap-1 text-xs font-medium text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
                >
                    {m['dashboard.activityViewAll']()} <ArrowRight className="h-3 w-3" />
                </Link>
            </div>
            <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-2">
                {isLoading && <p className="px-3 py-4 text-sm text-[var(--color-ink-faint)]">{m['common.states.loading']()}</p>}
                {!isLoading && (!entries || entries.length === 0) && (
                    <p className="px-3 py-4 text-sm text-[var(--color-ink-faint)]">{m['dashboard.noActivity']()}</p>
                )}
                {entries?.map((entry, i) => (
                    <FeedRow key={entry.id} entry={entry} first={i === 0} onInspect={setInspecting} />
                ))}
            </div>

            <ActivityDetailsModal entry={inspecting} onClose={() => setInspecting(null)} />
        </section>
    );
}

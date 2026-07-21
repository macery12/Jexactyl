import { m } from '@/i18n';
import { Lock } from 'lucide-react';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';

export interface ThreadMessage {
    id: number;
    body: string;
    authorName: string;
    /** Author is a staff member / admin (drives the "Staff" label). */
    isStaff: boolean;
    /** Authored by the person currently viewing — their own messages sit on the
     *  left; everyone else's replies sit on the right. */
    isMine: boolean;
    /** Admin-only private note — never shown on the client surface. */
    internalNote?: boolean;
    createdAt: string;
}

function initials(name: string): string {
    return name
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map(w => w[0]?.toUpperCase() ?? '')
        .join('') || '?';
}

function Avatar({ name, staff }: { name: string; staff: boolean }) {
    return (
        <span
            className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                staff
                    ? 'bg-[var(--brand)]/15 text-[var(--brand)] ring-1 ring-inset ring-[var(--brand)]/30'
                    : 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)] ring-1 ring-inset ring-[var(--color-border)]',
            )}
        >
            {initials(name)}
        </span>
    );
}

function Bubble({ msg }: { msg: ThreadMessage }) {
    if (msg.internalNote) {
        return (
            <li className="flex flex-col gap-1.5">
                <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-warning)]/40 bg-[var(--color-warning)]/[0.06] px-4 py-3">
                    <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-warning)]">
                        <Lock className="h-3 w-3" />
                        {m['tickets.thread.internalNote']()}
                        <span className="font-normal normal-case text-[var(--color-ink-faint)]">
                            · {msg.authorName} · {timeAgo(msg.createdAt)}
                        </span>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-sm text-[var(--color-ink)]">{msg.body}</p>
                </div>
            </li>
        );
    }

    // The viewer's own messages sit on the left; everyone else replies on the right.
    const onRight = !msg.isMine;
    return (
        <li className={cn('flex items-start gap-3', onRight && 'flex-row-reverse')}>
            <Avatar name={msg.authorName} staff={msg.isStaff} />
            <div className={cn('flex min-w-0 max-w-[85%] flex-col gap-1', onRight && 'items-end')}>
                <div className="flex items-center gap-2 text-xs text-[var(--color-ink-faint)]">
                    <span className="font-medium text-[var(--color-ink-muted)]">{msg.authorName}</span>
                    {msg.isStaff && (
                        <span className="rounded-full bg-[var(--brand)]/12 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--brand)]">
                            {m['tickets.thread.staff']()}
                        </span>
                    )}
                    <span>{timeAgo(msg.createdAt)}</span>
                </div>
                <div
                    className={cn(
                        'rounded-[var(--radius-card)] border px-4 py-2.5 text-sm',
                        msg.isMine
                            ? 'border-[var(--brand)]/30 bg-[var(--brand)]/10 text-[var(--color-ink)]'
                            : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-ink)]',
                    )}
                >
                    <p className="whitespace-pre-wrap break-words">{msg.body}</p>
                </div>
            </div>
        </li>
    );
}

// The shared conversation renderer for both the client ticket view and the staff
// console. Callers normalise their message shape into ThreadMessage[] so the
// bubble styling, staff badges and internal-note treatment stay identical.
export function Thread({ messages }: { messages: ThreadMessage[] }) {
    if (messages.length === 0) {
        return <p className="py-8 text-center text-sm text-[var(--color-ink-muted)]">{m['tickets.thread.empty']()}</p>;
    }
    return (
        <ul className="flex flex-col gap-5">
            {messages.map(msg => (
                <Bubble key={msg.id} msg={msg} />
            ))}
        </ul>
    );
}

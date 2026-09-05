import { m } from '@/i18n/messages';
import { cn } from '@/lib/cn';

// Shared vocabulary for the ticket surfaces (client + admin). Keeping the status
// / priority ordering, localized labels and themed chip classes in one module
// means the account queue and the staff console read identically.

export type TicketStatus = 'pending' | 'in-progress' | 'resolved' | 'unresolved';
export type TicketPriority = 'low' | 'medium' | 'high' | 'critical';

export const TICKET_STATUSES: TicketStatus[] = ['pending', 'in-progress', 'resolved', 'unresolved'];
export const TICKET_PRIORITIES: TicketPriority[] = ['low', 'medium', 'high', 'critical'];

export function statusLabel(status: TicketStatus): string {
    switch (status) {
        case 'pending':
            return m['tickets.status.pending']();
        case 'in-progress':
            return m['tickets.status.inProgress']();
        case 'resolved':
            return m['tickets.status.resolved']();
        case 'unresolved':
            return m['tickets.status.unresolved']();
    }
}

export function priorityLabel(priority: TicketPriority): string {
    switch (priority) {
        case 'low':
            return m['tickets.priority.low']();
        case 'medium':
            return m['tickets.priority.medium']();
        case 'high':
            return m['tickets.priority.high']();
        case 'critical':
            return m['tickets.priority.critical']();
    }
}

// Literal class strings (not interpolated) so Tailwind's scanner keeps them.
const STATUS_CHIP: Record<TicketStatus, string> = {
    pending: 'bg-[var(--color-warning)]/12 text-[var(--color-warning)] ring-[var(--color-warning)]/25',
    'in-progress': 'bg-[var(--brand)]/12 text-[var(--brand)] ring-[var(--brand)]/25',
    resolved: 'bg-[var(--color-accent)]/12 text-[var(--color-accent)] ring-[var(--color-accent)]/25',
    unresolved: 'bg-[var(--color-danger)]/12 text-[var(--color-danger)] ring-[var(--color-danger)]/25',
};

const STATUS_DOT: Record<TicketStatus, string> = {
    pending: 'bg-[var(--color-warning)]',
    'in-progress': 'bg-[var(--brand)]',
    resolved: 'bg-[var(--color-accent)]',
    unresolved: 'bg-[var(--color-danger)]',
};

const PRIORITY_CHIP: Record<TicketPriority, string> = {
    low: 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)] ring-[var(--color-border-strong)]',
    medium: 'bg-[var(--brand)]/12 text-[var(--brand)] ring-[var(--brand)]/25',
    high: 'bg-[var(--color-warning)]/12 text-[var(--color-warning)] ring-[var(--color-warning)]/25',
    critical: 'bg-[var(--color-danger)]/12 text-[var(--color-danger)] ring-[var(--color-danger)]/25',
};

export function StatusBadge({ status, className }: { status: TicketStatus; className?: string }) {
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
                STATUS_CHIP[status],
                className,
            )}
        >
            <span className={cn('h-1.5 w-1.5 rounded-full', STATUS_DOT[status])} />
            {statusLabel(status)}
        </span>
    );
}

export function PriorityBadge({ priority, className }: { priority: TicketPriority; className?: string }) {
    return (
        <span
            className={cn(
                'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset',
                PRIORITY_CHIP[priority],
                className,
            )}
        >
            {priorityLabel(priority)}
        </span>
    );
}

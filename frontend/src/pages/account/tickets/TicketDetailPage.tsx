import { m } from '@/i18n/messages';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Send, Trash2 } from 'lucide-react';
import { getTicket, replyToTicket, deleteTicket, type TicketMessage } from '@/api/tickets';
import { firstError } from '@/lib/apiError';
import { useFlashes } from '@/state/flashes';
import { useSession } from '@/state/session';
import { timeAgo } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { Textarea } from '@/components/ui/Textarea';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { StatusBadge, PriorityBadge } from '@/components/tickets/meta';
import { Thread, type ThreadMessage } from '@/components/tickets/Thread';

function toThread(messages: TicketMessage[], myEmail: string | undefined): ThreadMessage[] {
    return messages.map(msg => ({
        id: msg.id,
        body: msg.message,
        authorName: msg.author?.username ?? m['tickets.thread.unknown'](),
        isStaff: Boolean(msg.author?.admin),
        // Viewer-relative: my own messages left, staff replies right.
        isMine: !!myEmail && msg.author?.email === myEmail,
        createdAt: msg.createdAt,
    }));
}

export default function TicketDetailPage() {
    const { id } = useParams<{ id: string }>();
    const ticketId = Number(id);
    const qc = useQueryClient();
    const navigate = useNavigate();
    const { push } = useFlashes();
    const myEmail = useSession(s => s.user?.email);
    const [reply, setReply] = useState('');
    const [confirmDelete, setConfirmDelete] = useState(false);

    const { data: ticket, isLoading, isError } = useQuery({
        queryKey: ['account', 'tickets', ticketId],
        queryFn: () => getTicket(ticketId),
        enabled: Number.isFinite(ticketId),
    });

    const thread = useMemo(() => toThread(ticket?.messages ?? [], myEmail), [ticket, myEmail]);

    const replyMutation = useMutation({
        mutationFn: () => replyToTicket(ticketId, reply.trim()),
        onSuccess: () => {
            setReply('');
            qc.invalidateQueries({ queryKey: ['account', 'tickets', ticketId] });
            qc.invalidateQueries({ queryKey: ['account', 'tickets'] });
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const deleteMutation = useMutation({
        mutationFn: () => deleteTicket(ticketId),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['account', 'tickets'] });
            push({ type: 'success', message: m['tickets.deleted']() });
            navigate('/tickets');
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    if (isLoading) {
        return (
            <div className="flex min-h-[40vh] items-center justify-center">
                <Spinner className="h-6 w-6" />
            </div>
        );
    }
    if (isError || !ticket) {
        return (
            <div>
                <BackLink />
                <p className="mt-6 text-sm text-[var(--color-danger)]">{m['tickets.loadError']()}</p>
            </div>
        );
    }

    const canReply = reply.trim().length >= 3;

    return (
        <div className="flex w-full flex-col gap-5">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <BackLink />
                    <h1 className="mt-2 truncate text-2xl font-semibold tracking-tight">{ticket.title}</h1>
                    <p className="mt-1 text-xs text-[var(--color-ink-faint)]">{m['tickets.ref']({ id: ticket.id })}</p>
                </div>
                <StatusBadge status={ticket.status} />
            </div>

            <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
                {/* Conversation fills the space next to the details rail. */}
                <div className="flex min-w-0 flex-1 flex-col gap-4">
                    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]/40 px-4 py-5 sm:px-6">
                        <Thread messages={thread} />
                    </div>

                    <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                        <Textarea
                            value={reply}
                            rows={4}
                            maxLength={2000}
                            placeholder={m['tickets.reply.placeholder']()}
                            onChange={e => setReply(e.target.value)}
                        />
                        <div className="flex justify-end">
                            <Button onClick={() => replyMutation.mutate()} disabled={!canReply || replyMutation.isPending}>
                                {replyMutation.isPending ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                                {m['tickets.reply.submit']()}
                            </Button>
                        </div>
                    </div>
                </div>

                {/* Details sidebar */}
                <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-72">
                    <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-ink-faint)]">
                            {m['tickets.details']()}
                        </p>
                        <Row label={m['tickets.field.status']()}>
                            <StatusBadge status={ticket.status} />
                        </Row>
                        <Row label={m['tickets.field.priority']()}>
                            <PriorityBadge priority={ticket.priority} />
                        </Row>
                        <Meta label={m['tickets.field.opened']()} value={timeAgo(ticket.createdAt)} />
                        <Meta
                            label={m['tickets.field.lastReply']()}
                            value={ticket.lastReplyAt ? timeAgo(ticket.lastReplyAt) : '—'}
                        />
                    </div>

                    <Button variant="outline" onClick={() => setConfirmDelete(true)}>
                        <Trash2 className="h-4 w-4 text-[var(--color-danger)]" />
                        {m['tickets.delete']()}
                    </Button>
                </aside>
            </div>

            <ConfirmDialog
                open={confirmDelete}
                onClose={() => setConfirmDelete(false)}
                title={m['tickets.deleteConfirm.title']()}
                body={m['tickets.deleteConfirm.body']()}
                confirmLabel={m['tickets.delete']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={deleteMutation.isPending}
                onConfirm={() => deleteMutation.mutate()}
            />
        </div>
    );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-[var(--color-ink-faint)]">{label}</span>
            {children}
        </div>
    );
}

function Meta({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-3 text-xs">
            <span className="text-[var(--color-ink-faint)]">{label}</span>
            <span className="truncate text-right text-[var(--color-ink)]">{value}</span>
        </div>
    );
}

function BackLink() {
    return (
        <Link
            to="/tickets"
            className="inline-flex w-fit items-center gap-1.5 text-sm text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
        >
            <ArrowLeft className="h-4 w-4" />
            {m['tickets.backToList']()}
        </Link>
    );
}

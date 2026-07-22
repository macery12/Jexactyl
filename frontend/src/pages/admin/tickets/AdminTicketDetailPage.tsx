import { m } from '@/i18n';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Send, Trash2, Lock, Save } from 'lucide-react';
import {
    getAdminTicket,
    updateAdminTicket,
    replyAdminTicket,
    deleteAdminTicket,
    type AdminTicketMessage,
} from '@/api/adminTickets';
import { getUsers } from '@/api/adminUsers';
import { firstError } from '@/lib/apiError';
import { useFlashes } from '@/state/flashes';
import { useSession } from '@/state/session';
import { can } from '@/lib/can';
import { useAdminHeld } from '@/layouts/heldPermissions';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Field } from '@/components/ui/Input';
import {
    StatusBadge,
    TICKET_STATUSES,
    TICKET_PRIORITIES,
    statusLabel,
    priorityLabel,
    type TicketStatus,
    type TicketPriority,
} from '@/components/tickets/meta';
import { Thread, type ThreadMessage } from '@/components/tickets/Thread';

function toThread(messages: AdminTicketMessage[], myEmail: string | undefined): ThreadMessage[] {
    return messages.map(msg => ({
        id: msg.id,
        body: msg.message,
        authorName: msg.author?.username ?? m['tickets.thread.unknown'](),
        isStaff: Boolean(msg.author?.admin),
        // Viewer-relative: my own replies left, other staff / the requester right.
        isMine: !!myEmail && msg.author?.email === myEmail,
        internalNote: msg.internalNote,
        createdAt: msg.createdAt,
    }));
}

export default function AdminTicketDetailPage() {
    const { id } = useParams<{ id: string }>();
    const ticketId = Number(id);
    const qc = useQueryClient();
    const navigate = useNavigate();
    const { push } = useFlashes();
    const myEmail = useSession(s => s.user?.email);
    const held = useAdminHeld();

    const canUpdate = can(held, 'tickets.update');
    const canMessage = can(held, 'tickets.message');
    const canDelete = can(held, 'tickets.delete');

    const [reply, setReply] = useState('');
    const [internalNote, setInternalNote] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);

    // Editable properties (initialised from the loaded ticket).
    const [status, setStatus] = useState<TicketStatus>('pending');
    const [priority, setPriority] = useState<TicketPriority>('medium');
    const [assignee, setAssignee] = useState<string>('');

    const { data: ticket, isLoading, isError } = useQuery({
        queryKey: ['admin', 'tickets', ticketId],
        queryFn: () => getAdminTicket(ticketId),
        enabled: Number.isFinite(ticketId),
    });

    const { data: users } = useQuery({ queryKey: ['admin', 'users'], queryFn: () => getUsers() });

    useEffect(() => {
        if (!ticket) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: syncs state to prop/query/filter changes
        setStatus(ticket.status);
        setPriority(ticket.priority);
        setAssignee(ticket.assignedTo ? String(ticket.assignedTo.id) : '');
    }, [ticket]);

    const thread = useMemo(() => toThread(ticket?.messages ?? [], myEmail), [ticket, myEmail]);

    const updateMutation = useMutation({
        mutationFn: () => {
            if (!ticket?.user) throw new Error('missing requester');
            return updateAdminTicket(ticketId, {
                title: ticket.title,
                userId: ticket.user.id,
                status,
                priority,
                assignedTo: assignee ? Number(assignee) : null,
            });
        },
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'tickets', ticketId] });
            qc.invalidateQueries({ queryKey: ['admin', 'tickets'] });
            push({ type: 'success', message: m['admin.tickets.saved']() });
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const replyMutation = useMutation({
        mutationFn: () => replyAdminTicket(ticketId, reply.trim(), internalNote),
        onSuccess: () => {
            setReply('');
            setInternalNote(false);
            qc.invalidateQueries({ queryKey: ['admin', 'tickets', ticketId] });
            qc.invalidateQueries({ queryKey: ['admin', 'tickets'] });
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const deleteMutation = useMutation({
        mutationFn: () => deleteAdminTicket(ticketId),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'tickets'] });
            push({ type: 'success', message: m['tickets.deleted']() });
            navigate('/admin/tickets');
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

    const dirty =
        status !== ticket.status ||
        priority !== ticket.priority ||
        assignee !== (ticket.assignedTo ? String(ticket.assignedTo.id) : '');

    const canReply = reply.trim().length >= 3;

    const statusOptions = TICKET_STATUSES.map(s => ({ value: s, label: statusLabel(s) }));
    const priorityOptions = TICKET_PRIORITIES.map(p => ({ value: p, label: priorityLabel(p) }));
    const assigneeOptions = [
        { value: '', label: m['admin.tickets.unassigned']() },
        ...(users ?? []).map(u => ({ value: String(u.id), label: `${u.username} (${u.email})` })),
    ];

    return (
        <div className="flex flex-col gap-5">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <BackLink />
                    <h1 className="mt-2 truncate text-xl font-semibold text-[var(--color-ink)]">{ticket.title}</h1>
                    <p className="mt-1 text-xs text-[var(--color-ink-faint)]">
                        {m['tickets.ref']({ id: ticket.id })} · {m['admin.tickets.openedBy']({ name: ticket.user?.username ?? '—' })}
                    </p>
                </div>
                <StatusBadge status={ticket.status} />
            </div>

            <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
                {/* Conversation fills the space next to the properties rail. */}
                <div className="flex min-w-0 flex-1 flex-col gap-4">
                    <div className="rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]/40 px-4 py-5 sm:px-6">
                        <Thread messages={thread} />
                    </div>

                    {canMessage && (
                        <div className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                            <Textarea
                                value={reply}
                                rows={4}
                                maxLength={2000}
                                placeholder={
                                    internalNote ? m['admin.tickets.notePlaceholder']() : m['tickets.reply.placeholder']()
                                }
                                onChange={e => setReply(e.target.value)}
                                className={internalNote ? 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/[0.05]' : undefined}
                            />
                            <div className="flex items-center justify-between gap-3">
                                <button
                                    type="button"
                                    onClick={() => setInternalNote(v => !v)}
                                    className={cn(
                                        'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors',
                                        internalNote
                                            ? 'bg-[var(--color-warning)]/12 text-[var(--color-warning)] ring-1 ring-inset ring-[var(--color-warning)]/25'
                                            : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)]',
                                    )}
                                >
                                    <Lock className="h-3.5 w-3.5" />
                                    {m['admin.tickets.internalNoteToggle']()}
                                </button>
                                <Button onClick={() => replyMutation.mutate()} disabled={!canReply || replyMutation.isPending}>
                                    {replyMutation.isPending ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                                    {internalNote ? m['admin.tickets.addNote']() : m['tickets.reply.submit']()}
                                </Button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Properties sidebar */}
                <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-72">
                    <div className="flex flex-col gap-4 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-ink-faint)]">
                            {m['admin.tickets.properties']()}
                        </p>
                        <Field label={m['admin.tickets.col.status']()}>
                            <Select value={status} onChange={v => setStatus(v as TicketStatus)} options={statusOptions} disabled={!canUpdate} />
                        </Field>
                        <Field label={m['admin.tickets.col.priority']()}>
                            <Select value={priority} onChange={v => setPriority(v as TicketPriority)} options={priorityOptions} disabled={!canUpdate} />
                        </Field>
                        <Field label={m['admin.tickets.col.assignee']()}>
                            <Select value={assignee} onChange={setAssignee} options={assigneeOptions} disabled={!canUpdate} />
                        </Field>
                        {canUpdate && (
                            <Button onClick={() => updateMutation.mutate()} disabled={!dirty || updateMutation.isPending}>
                                {updateMutation.isPending ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                                {m['common.actions.saveChanges']()}
                            </Button>
                        )}
                    </div>

                    <div className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 text-xs text-[var(--color-ink-muted)]">
                        <Meta label={m['admin.tickets.col.requester']()} value={ticket.user?.username ?? '—'} />
                        <Meta label={m['admin.tickets.email']()} value={ticket.user?.email ?? '—'} />
                        <Meta label={m['admin.tickets.opened']()} value={timeAgo(ticket.createdAt)} />
                        <Meta
                            label={m['admin.tickets.col.lastReply']()}
                            value={ticket.lastReplyAt ? timeAgo(ticket.lastReplyAt) : '—'}
                        />
                    </div>

                    {canDelete && (
                        <Button variant="outline" onClick={() => setConfirmDelete(true)}>
                            <Trash2 className="h-4 w-4 text-[var(--color-danger)]" />
                            {m['admin.tickets.deleteTicket']()}
                        </Button>
                    )}
                </aside>
            </div>

            <ConfirmDialog
                open={confirmDelete}
                onClose={() => setConfirmDelete(false)}
                title={m['tickets.deleteConfirm.title']()}
                body={m['admin.tickets.deleteConfirmBody']()}
                confirmLabel={m['admin.tickets.deleteTicket']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={deleteMutation.isPending}
                onConfirm={() => deleteMutation.mutate()}
            />
        </div>
    );
}

function Meta({ label, value }: { label: string; value: string }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <span className="text-[var(--color-ink-faint)]">{label}</span>
            <span className="truncate text-right text-[var(--color-ink)]">{value}</span>
        </div>
    );
}

function BackLink() {
    return (
        <Link
            to="/admin/tickets"
            className="inline-flex w-fit items-center gap-1.5 text-sm text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
        >
            <ArrowLeft className="h-4 w-4" />
            {m['admin.tickets.backToQueue']()}
        </Link>
    );
}

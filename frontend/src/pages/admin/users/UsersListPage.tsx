import { m } from '@/i18n';
import { useEffect, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import {
    ChevronLeft,
    ChevronRight,
    MailCheck,
    MailX,
    MoreVertical,
    Pencil,
    Plus,
    Power,
    PowerOff,
    Search,
    ShieldCheck,
    Trash2,
    Users,
} from 'lucide-react';
import {
    getAdminUsers,
    deleteUser,
    suspendUser,
    verifyUserEmail,
    type AdminUserRow,
} from '@/api/adminUsers';
import { timeAgo } from '@/lib/format';
import { can } from '@/lib/can';
import { useAdminHeld } from '@/layouts/heldPermissions';
import { useFlashes } from '@/state/flashes';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useFullWidthContent } from '@/components/shell/shellLayout';
import UserFormModal from './UserFormModal';

function RowActions({
    user,
    canUpdate,
    canDelete,
    onEdit,
    onDelete,
}: {
    user: AdminUserRow;
    canUpdate: boolean;
    canDelete: boolean;
    onEdit: () => void;
    onDelete: () => void;
}) {
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();

    if (!canUpdate && !canDelete) return null;

    const act = (fn: () => Promise<void>, msg: string) =>
        fn()
            .then(() => {
                push({ type: 'success', message: msg });
                return qc.invalidateQueries({ queryKey: ['admin', 'users'] });
            })
            .catch(() => push({ type: 'error', message: m['common.states.genericError']() }));

    return (
        <Dropdown.Root>
            <Dropdown.Trigger
                aria-label={m['admin.users.actionsLabel']()}
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] focus:outline-none"
            >
                <MoreVertical className="h-4 w-4" />
            </Dropdown.Trigger>
            <Dropdown.Portal>
                <Dropdown.Content
                    align="end"
                    sideOffset={4}
                    className="z-[60] w-48 overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-1 shadow-xl shadow-black/30"
                >
                    {canUpdate && (
                        <>
                            <Item icon={Pencil} label={m['common.actions.edit']()} onSelect={onEdit} />
                            {!user.rootAdmin &&
                                (user.suspended ? (
                                    <Item
                                        icon={Power}
                                        label={m['admin.users.unsuspend']()}
                                        onSelect={() => act(() => suspendUser(user.id), m['admin.users.unsuspended']())}
                                    />
                                ) : (
                                    <Item
                                        icon={PowerOff}
                                        label={m['admin.users.suspend']()}
                                        onSelect={() => act(() => suspendUser(user.id), m['admin.users.suspended']())}
                                    />
                                ))}
                            {user.emailVerified ? (
                                <Item
                                    icon={MailX}
                                    label={m['admin.users.unverifyEmail']()}
                                    onSelect={() => act(() => verifyUserEmail(user.id, false), m['admin.users.emailUnverified']())}
                                />
                            ) : (
                                <Item
                                    icon={MailCheck}
                                    label={m['admin.users.verifyEmail']()}
                                    onSelect={() => act(() => verifyUserEmail(user.id, true), m['admin.users.emailVerified']())}
                                />
                            )}
                        </>
                    )}
                    {canDelete && <Item icon={Trash2} label={m['common.actions.delete']()} danger onSelect={onDelete} />}
                </Dropdown.Content>
            </Dropdown.Portal>
        </Dropdown.Root>
    );
}

function Item({
    icon: Icon,
    label,
    onSelect,
    danger,
}: {
    icon: typeof Pencil;
    label: string;
    onSelect: () => void;
    danger?: boolean;
}) {
    return (
        <Dropdown.Item
            onSelect={onSelect}
            className={`flex cursor-pointer select-none items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-[var(--color-surface-2)] ${
                danger ? 'text-[var(--color-danger)]' : 'text-[var(--color-ink)]'
            }`}
        >
            <Icon className="h-3.5 w-3.5" /> {label}
        </Dropdown.Item>
    );
}

function StatusPill({ user }: { user: AdminUserRow }) {
    const [label, cls] = user.suspended
        ? [m['admin.users.status.suspended'](), 'bg-[var(--color-danger)]/15 text-[var(--color-danger)]']
        : !user.emailVerified
          ? [m['admin.users.status.unverified'](), 'bg-[var(--color-warning)]/15 text-[var(--color-warning)]']
          : [m['admin.users.status.active'](), 'bg-[var(--color-accent)]/15 text-[var(--color-accent)]'];
    return (
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{label}</span>
    );
}

export default function UsersListPage() {
    useFullWidthContent();
    const held = useAdminHeld();
    const canCreate = can(held, 'users.create');
    const canUpdate = can(held, 'users.update');
    const canDelete = can(held, 'users.delete');

    const push = useFlashes(s => s.push);
    const qc = useQueryClient();

    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(1);
    const [formOpen, setFormOpen] = useState(false);
    const [editUser, setEditUser] = useState<AdminUserRow | null>(null);
    const [toDelete, setToDelete] = useState<AdminUserRow | null>(null);

    // Debounce the search box, and reset to the first page on a new term.
    useEffect(() => {
        const t = setTimeout(() => {
            setSearch(searchInput.trim());
            setPage(1);
        }, 300);
        return () => clearTimeout(t);
    }, [searchInput]);

    const { data, isLoading, isError, isFetching } = useQuery({
        queryKey: ['admin', 'users', { page, search }],
        queryFn: () => getAdminUsers({ page, search: search || undefined, sort: '-root_admin' }),
        placeholderData: keepPreviousData,
    });

    const items = data?.items ?? [];
    const pagination = data?.pagination;

    const del = useMutation({
        mutationFn: (id: number) => deleteUser(id),
        onSuccess: async () => {
            push({ type: 'success', message: m['admin.users.deleted']() });
            await qc.invalidateQueries({ queryKey: ['admin', 'users'] });
            setToDelete(null);
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    const openCreate = () => {
        setEditUser(null);
        setFormOpen(true);
    };
    const openEdit = (user: AdminUserRow) => {
        setEditUser(user);
        setFormOpen(true);
    };

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold text-[var(--color-ink)]">{m['admin.users.title']()}</h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.users.subtitle']()}</p>
                </div>
                {canCreate && (
                    <Button onClick={openCreate}>
                        <Plus className="h-4 w-4" />
                        {m['admin.users.create']()}
                    </Button>
                )}
            </div>

            <div className="relative max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
                <Input
                    value={searchInput}
                    onChange={e => setSearchInput(e.target.value)}
                    placeholder={m['admin.users.searchPlaceholder']()}
                    className="pl-9"
                />
            </div>

            <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]">
                {isLoading ? (
                    <div className="flex justify-center py-14">
                        <Spinner className="h-5 w-5" />
                    </div>
                ) : isError ? (
                    <p className="px-4 py-10 text-center text-sm text-[var(--color-danger)]">{m['admin.users.loadError']()}</p>
                ) : items.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
                        <Users className="h-8 w-8 text-[var(--color-ink-faint)]" />
                        <p className="text-sm text-[var(--color-ink-muted)]">{m['admin.users.empty']()}</p>
                    </div>
                ) : (
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-[var(--color-border)] text-left text-xs uppercase tracking-wide text-[var(--color-ink-faint)]">
                                <th className="px-4 py-2.5 font-medium">{m['admin.users.col.user']()}</th>
                                <th className="hidden px-4 py-2.5 font-medium md:table-cell">{m['admin.users.col.email']()}</th>
                                <th className="hidden px-4 py-2.5 font-medium lg:table-cell">{m['admin.users.col.role']()}</th>
                                <th className="px-4 py-2.5 font-medium">{m['admin.users.col.status']()}</th>
                                <th className="hidden px-4 py-2.5 font-medium sm:table-cell">{m['admin.users.col.created']()}</th>
                                <th className="w-8 px-4 py-2.5" />
                            </tr>
                        </thead>
                        <tbody>
                            {items.map(u => (
                                <tr
                                    key={u.id}
                                    className="border-b border-[var(--color-border)] transition-colors last:border-0 hover:bg-[var(--color-surface-2)]/40"
                                >
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-3">
                                            {u.avatarUrl ? (
                                                <img src={u.avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full" />
                                            ) : (
                                                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-xs font-semibold text-[var(--color-ink-muted)]">
                                                    {u.username.charAt(0).toUpperCase()}
                                                </span>
                                            )}
                                            <div className="min-w-0">
                                                <span className="flex items-center gap-1.5 font-medium text-[var(--color-ink)]">
                                                    <span className="truncate">{u.username}</span>
                                                    {u.rootAdmin && (
                                                        <ShieldCheck
                                                            className="h-3.5 w-3.5 shrink-0 text-[var(--brand)]"
                                                            aria-label={m['admin.users.rootAdmin']()}
                                                        />
                                                    )}
                                                </span>
                                                <span className="block truncate text-xs text-[var(--color-ink-faint)] md:hidden">
                                                    {u.email}
                                                </span>
                                            </div>
                                        </div>
                                    </td>
                                    <td className="hidden px-4 py-3 text-[var(--color-ink-muted)] md:table-cell">{u.email}</td>
                                    <td className="hidden px-4 py-3 text-[var(--color-ink-muted)] lg:table-cell">
                                        {u.rootAdmin ? m['admin.users.rootAdmin']() : u.adminRoleId ? u.roleName : '—'}
                                    </td>
                                    <td className="px-4 py-3">
                                        <StatusPill user={u} />
                                    </td>
                                    <td className="hidden px-4 py-3 text-xs text-[var(--color-ink-faint)] sm:table-cell">
                                        {timeAgo(u.createdAt)}
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <RowActions
                                            user={u}
                                            canUpdate={canUpdate}
                                            canDelete={canDelete}
                                            onEdit={() => openEdit(u)}
                                            onDelete={() => setToDelete(u)}
                                        />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            {pagination && pagination.totalPages > 1 && (
                <div className="flex items-center justify-between">
                    <p className="text-xs text-[var(--color-ink-faint)]">
                        {m['activity.pageOf']({ current: pagination.currentPage, total: pagination.totalPages })}
                        {isFetching && <Spinner className="ml-2 inline h-3 w-3" />}
                    </p>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={pagination.currentPage <= 1 || isFetching}
                            onClick={() => setPage(p => Math.max(1, p - 1))}
                        >
                            <ChevronLeft className="h-4 w-4" />
                            {m['activity.prev']()}
                        </Button>
                        <Button
                            variant="outline"
                            size="sm"
                            disabled={pagination.currentPage >= pagination.totalPages || isFetching}
                            onClick={() => setPage(p => p + 1)}
                        >
                            {m['activity.next']()}
                            <ChevronRight className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
            )}

            <UserFormModal open={formOpen} onClose={() => setFormOpen(false)} user={editUser} />

            <ConfirmDialog
                open={!!toDelete}
                onClose={() => setToDelete(null)}
                title={m['admin.users.deleteTitle']()}
                body={m['admin.users.deleteBody']({ name: toDelete?.username ?? '' })}
                confirmLabel={m['common.actions.delete']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={del.isPending}
                onConfirm={() => toDelete && del.mutate(toDelete.id)}
            />
        </div>
    );
}

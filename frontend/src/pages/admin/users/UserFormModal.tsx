import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { m } from '@/i18n';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { Spinner } from '@/components/ui/Spinner';
import { useFlashes } from '@/state/flashes';
import { useSession } from '@/state/session';
import { firstError } from '@/lib/apiError';
import { createUser, updateUser, type AdminUserRow, type CreateUserInput } from '@/api/adminUsers';
import { getAdminRoles } from '@/api/adminRoles';

// Create / edit dialog for an admin user. Assigning an admin role or root-admin
// status is restricted to root administrators (the backend rejects otherwise),
// so those controls are disabled for everyone else.
export default function UserFormModal({
    open,
    onClose,
    user,
}: {
    open: boolean;
    onClose: () => void;
    user: AdminUserRow | null;
}) {
    const editing = user !== null;
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();
    const isRoot = useSession(s => Boolean(s.user?.root_admin));

    const [username, setUsername] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [externalId, setExternalId] = useState('');
    const [rootAdmin, setRootAdmin] = useState(false);
    const [roleId, setRoleId] = useState<string>('');
    const [error, setError] = useState<string | null>(null);

    // Reset the form whenever the dialog opens for a (different) user.
    useEffect(() => {
        if (!open) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: syncs state to prop/query/filter changes
        setUsername(user?.username ?? '');
        setEmail(user?.email ?? '');
        setPassword('');
        setExternalId(user?.externalId ?? '');
        setRootAdmin(user?.rootAdmin ?? false);
        setRoleId(user?.adminRoleId != null ? String(user.adminRoleId) : '');
        setError(null);
    }, [open, user]);

    const { data: rolesData } = useQuery({
        queryKey: ['admin', 'roles', 'all'],
        queryFn: () => getAdminRoles({ perPage: 100 }),
        enabled: open && isRoot,
    });

    const roleOptions = useMemo(
        () => [
            { value: '', label: m['admin.users.form.noRole']() },
            ...(rolesData?.items ?? []).map(r => ({ value: String(r.id), label: r.name })),
        ],
        [rolesData],
    );

    const mutation = useMutation({
        mutationFn: () => {
            const base: Partial<CreateUserInput> = { username, email, externalId: externalId || null };
            if (password) base.password = password;
            // Only root admins may change role / root-admin; still send current
            // values so the backend's "unchanged" check passes for other admins.
            base.rootAdmin = rootAdmin;
            base.adminRoleId = roleId ? Number(roleId) : null;
            return editing ? updateUser(user!.id, base) : createUser(base as CreateUserInput);
        },
        onSuccess: async () => {
            push({ type: 'success', message: editing ? m['admin.users.updated']() : m['admin.users.created']() });
            await qc.invalidateQueries({ queryKey: ['admin', 'users'] });
            onClose();
        },
        onError: err => setError(firstError(err) ?? m['common.states.genericError']()),
    });

    const canSubmit = username.trim() && email.trim() && (editing || password);

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={editing ? m['admin.users.editTitle']() : m['admin.users.createTitle']()}
            description={editing ? m['admin.users.editSubtitle']() : m['admin.users.createSubtitle']()}
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={mutation.isPending}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button size="sm" onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending}>
                        {mutation.isPending && <Spinner className="h-4 w-4" />}
                        {editing ? m['common.actions.saveChanges']() : m['admin.users.create']()}
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                {error && (
                    <p className="rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">
                        {error}
                    </p>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={m['admin.users.form.username']()}>
                        <Input value={username} onChange={e => setUsername(e.target.value)} autoComplete="off" />
                    </Field>
                    <Field label={m['admin.users.form.email']()}>
                        <Input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="off" />
                    </Field>
                </div>

                <Field
                    label={editing ? m['admin.users.form.newPassword']() : m['admin.users.form.password']()}
                    hint={editing ? m['admin.users.form.newPasswordHint']() : undefined}
                >
                    <Input
                        type="password"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        autoComplete="new-password"
                        placeholder={editing ? m['admin.users.form.unchanged']() : undefined}
                    />
                </Field>

                <Field label={m['admin.users.form.externalId']()} hint={m['admin.users.form.externalIdHint']()}>
                    <Input value={externalId} onChange={e => setExternalId(e.target.value)} autoComplete="off" />
                </Field>

                {isRoot ? (
                    <>
                        <Field label={m['admin.users.form.role']()} hint={m['admin.users.form.roleHint']()}>
                            <Select value={roleId} onChange={setRoleId} options={roleOptions} disabled={rootAdmin} />
                        </Field>
                        <label className="flex items-start gap-3 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)]/50 p-3">
                            <span className="min-w-0 flex-1">
                                <span className="block text-sm font-medium text-[var(--color-ink)]">
                                    {m['admin.users.form.rootAdmin']()}
                                </span>
                                <span className="mt-0.5 block text-xs text-[var(--color-ink-muted)]">
                                    {m['admin.users.form.rootAdminHint']()}
                                </span>
                            </span>
                            <Switch checked={rootAdmin} onChange={setRootAdmin} className="mt-0.5" />
                        </label>
                    </>
                ) : (
                    <p className="rounded-lg bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-ink-muted)]">
                        {m['admin.users.form.roleRootOnly']()}
                    </p>
                )}
            </div>
        </Modal>
    );
}

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { m } from '@/i18n';
import { can } from '@/lib/can';
import { useServer } from '@/components/server/ServerContext';
import { useFlashes } from '@/state/flashes';
import { getPermissionGroups, saveSubuser, type Subuser } from '@/api/subusers';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { Spinner } from '@/components/ui/Spinner';

// Create/edit a subuser. Email is fixed on edit; permissions are chosen from the
// grouped catalog. The editor can only grant permissions they themselves hold
// (mirrors V1) — everything else renders disabled.
export default function SubuserFormModal({
    subuser,
    held,
    onClose,
    onSaved,
}: {
    subuser: Subuser | null;
    held: string[];
    onClose: () => void;
    onSaved: () => void;
}) {
    const server = useServer();
    const push = useFlashes(s => s.push);
    const isEdit = !!subuser;

    const [email, setEmail] = useState(subuser?.email ?? '');
    const [selected, setSelected] = useState<Set<string>>(new Set(subuser?.permissions ?? []));

    const { data: groups, isLoading } = useQuery({
        queryKey: ['server', 'permissionGroups'],
        queryFn: getPermissionGroups,
        staleTime: 10 * 60_000,
    });

    const toggle = (fullKey: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(fullKey)) next.delete(fullKey);
            else next.add(fullKey);
            return next;
        });
    };

    // Only permissions the editor holds are grantable.
    const grantable = useMemo(
        () => (fullKey: string) => can(held, fullKey),
        [held],
    );

    const save = useMutation({
        mutationFn: () =>
            saveSubuser(
                server.uuid,
                { email: email.trim(), permissions: [...selected] },
                subuser ?? undefined,
            ),
        onSuccess: () => {
            push({ type: 'success', message: isEdit ? m['server.users.updated']() : m['server.users.created']() });
            onSaved();
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    return (
        <Modal
            open
            onClose={onClose}
            size="lg"
            title={isEdit ? m['server.users.editTitle']() : m['server.users.addTitle']()}
            description={isEdit ? subuser!.email : m['server.users.addDesc']()}
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={save.isPending}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button
                        size="sm"
                        onClick={() => save.mutate()}
                        disabled={save.isPending || (!isEdit && email.trim().length === 0) || selected.size === 0}
                    >
                        {save.isPending && <Spinner className="h-4 w-4" />}
                        {m['common.actions.save']()}
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-5">
                {!isEdit && (
                    <Field label={m['server.users.email']()} htmlFor="subuser-email">
                        <Input
                            id="subuser-email"
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            placeholder={m['server.users.emailPlaceholder']()}
                        />
                    </Field>
                )}

                {isLoading || !groups ? (
                    <div className="flex justify-center py-8">
                        <Spinner className="h-5 w-5" />
                    </div>
                ) : (
                    <div className="flex flex-col gap-4">
                        {groups.map(group => {
                            const keys = group.permissions.map(p => p.fullKey);
                            const grantableKeys = keys.filter(grantable);
                            const allOn = grantableKeys.length > 0 && grantableKeys.every(k => selected.has(k));
                            return (
                                <div
                                    key={group.key}
                                    className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/40"
                                >
                                    <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-2.5">
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold capitalize text-[var(--color-ink)]">{group.key}</p>
                                            <p className="text-xs text-[var(--color-ink-faint)]">{group.description}</p>
                                        </div>
                                        <label className="flex shrink-0 items-center gap-2 text-xs text-[var(--color-ink-muted)]">
                                            {m['server.users.selectAll']()}
                                            <Switch
                                                checked={allOn}
                                                disabled={grantableKeys.length === 0}
                                                onChange={next =>
                                                    setSelected(prev => {
                                                        const s = new Set(prev);
                                                        grantableKeys.forEach(k => (next ? s.add(k) : s.delete(k)));
                                                        return s;
                                                    })
                                                }
                                                label={m['server.users.selectAll']()}
                                            />
                                        </label>
                                    </div>
                                    <div className="grid grid-cols-1 gap-x-4 p-3 sm:grid-cols-2">
                                        {group.permissions.map(perm => {
                                            const allowed = grantable(perm.fullKey);
                                            return (
                                                <label
                                                    key={perm.fullKey}
                                                    className={`flex items-start justify-between gap-3 rounded-lg px-2 py-2 ${
                                                        allowed ? '' : 'opacity-50'
                                                    }`}
                                                >
                                                    <span className="min-w-0">
                                                        <span className="block text-sm text-[var(--color-ink)]">{perm.key}</span>
                                                        <span className="block text-xs text-[var(--color-ink-faint)]">
                                                            {perm.description}
                                                        </span>
                                                    </span>
                                                    <Switch
                                                        checked={selected.has(perm.fullKey)}
                                                        disabled={!allowed}
                                                        onChange={() => toggle(perm.fullKey)}
                                                        label={perm.fullKey}
                                                    />
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </Modal>
    );
}

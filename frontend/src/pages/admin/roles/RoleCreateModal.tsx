import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { m } from '@/i18n';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { createRole } from '@/api/adminRoles';

const DEFAULT_COLOR = '#6366f1';

// Small create dialog. Only the metadata is set here; permissions are assigned
// on the detail page the operator lands on right after creation.
export default function RoleCreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();
    const navigate = useNavigate();

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [color, setColor] = useState(DEFAULT_COLOR);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: syncs state to prop/query/filter changes
        setName('');
        setDescription('');
        setColor(DEFAULT_COLOR);
        setError(null);
    }, [open]);

    const mutation = useMutation({
        mutationFn: () => createRole({ name, description: description || null, color }),
        onSuccess: async role => {
            push({ type: 'success', message: m['admin.roles.created']() });
            await qc.invalidateQueries({ queryKey: ['admin', 'roles'] });
            onClose();
            navigate(`/admin/roles/${role.id}`);
        },
        onError: err => setError(firstError(err) ?? m['common.states.genericError']()),
    });

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={m['admin.roles.createTitle']()}
            description={m['admin.roles.createSubtitle']()}
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={mutation.isPending}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button size="sm" onClick={() => mutation.mutate()} disabled={!name.trim() || mutation.isPending}>
                        {mutation.isPending && <Spinner className="h-4 w-4" />}
                        {m['admin.roles.create']()}
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
                <Field label={m['admin.roles.form.name']()}>
                    <Input value={name} onChange={e => setName(e.target.value)} maxLength={64} autoComplete="off" />
                </Field>
                <Field label={m['admin.roles.form.description']()}>
                    <Input value={description} onChange={e => setDescription(e.target.value)} maxLength={255} autoComplete="off" />
                </Field>
                <Field label={m['admin.roles.form.color']()} hint={m['admin.roles.form.colorHint']()}>
                    <div className="flex items-center gap-3">
                        <input
                            type="color"
                            value={color}
                            onChange={e => setColor(e.target.value)}
                            className="h-11 w-14 shrink-0 cursor-pointer rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] p-1"
                            aria-label={m['admin.roles.form.color']()}
                        />
                        <Input value={color} onChange={e => setColor(e.target.value)} maxLength={9} className="font-mono" />
                    </div>
                </Field>
            </div>
        </Modal>
    );
}

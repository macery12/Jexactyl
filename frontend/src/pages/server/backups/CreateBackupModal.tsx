import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { m } from '@/i18n/messages';
import { can } from '@/lib/can';
import { useServer } from '@/components/server/ServerContext';
import { useFlashes } from '@/state/flashes';
import { createBackup } from '@/api/backups';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Switch } from '@/components/ui/Switch';
import { Spinner } from '@/components/ui/Spinner';

export default function CreateBackupModal({ onClose }: { onClose: () => void }) {
    const server = useServer();
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();
    // Locking a backup is only meaningful if you could otherwise delete it.
    const canLock = can(server.permissions, 'backup.delete');

    const [name, setName] = useState('');
    const [ignored, setIgnored] = useState('');
    const [isLocked, setIsLocked] = useState(false);

    const tooLong = name.length > 191;

    const create = useMutation({
        mutationFn: () => createBackup(server.uuid, { name: name.trim(), ignored, isLocked }),
        onSuccess: () => {
            push({ type: 'success', message: m['server.backups.started']() });
            qc.invalidateQueries({ queryKey: ['server', server.id, 'backups'] });
            onClose();
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    return (
        <Modal
            open
            onClose={onClose}
            title={m['server.backups.createTitle']()}
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={create.isPending}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button size="sm" onClick={() => create.mutate()} disabled={create.isPending || tooLong}>
                        {create.isPending && <Spinner className="h-4 w-4" />}
                        {m['server.backups.createSubmit']()}
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-5">
                <Field
                    label={m['server.backups.name']()}
                    hint={m['server.backups.nameHint']()}
                    error={tooLong ? m['server.backups.errors.nameTooLong']() : undefined}
                    htmlFor="backup-name"
                >
                    <Input
                        id="backup-name"
                        value={name}
                        autoFocus
                        invalid={tooLong}
                        onChange={e => setName(e.target.value)}
                    />
                </Field>
                <Field
                    label={m['server.backups.ignored']()}
                    hint={m['server.backups.ignoredHint']()}
                    htmlFor="backup-ignored"
                >
                    <Textarea
                        id="backup-ignored"
                        rows={6}
                        value={ignored}
                        className="font-mono text-xs"
                        onChange={e => setIgnored(e.target.value)}
                    />
                </Field>
                {canLock && (
                    <label className="flex items-start gap-3 rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4">
                        <Switch checked={isLocked} onChange={setIsLocked} label={m['server.backups.locked']()} />
                        <span className="flex flex-col gap-0.5">
                            <span className="text-sm font-medium text-[var(--color-ink)]">
                                {m['server.backups.locked']()}
                            </span>
                            <span className="text-xs text-[var(--color-ink-faint)]">
                                {m['server.backups.lockedHint']()}
                            </span>
                        </span>
                    </label>
                )}
            </div>
        </Modal>
    );
}

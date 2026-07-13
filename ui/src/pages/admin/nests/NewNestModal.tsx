import { useState } from 'react';
import { m } from '@/i18n';
import { firstError } from '@/lib/apiError';
import { useFlashes } from '@/state/flashes';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { createNest, type AdminNest } from '@/api/adminNests';

export function NewNestModal({ onClose, onCreated }: { onClose: () => void; onCreated: (nest: AdminNest) => void }) {
    const push = useFlashes(s => s.push);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [author, setAuthor] = useState('');
    const [saving, setSaving] = useState(false);

    const submit = async () => {
        if (!name.trim() || !author.trim()) {
            push({ type: 'error', message: m['admin.nests.nest.createValidation']() });
            return;
        }
        setSaving(true);
        try {
            const nest = await createNest(name.trim(), description.trim(), author.trim());
            push({ type: 'success', message: m['admin.nests.nest.created']() });
            onCreated(nest);
            onClose();
        } catch (err) {
            push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() });
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            open
            onClose={onClose}
            title={m['admin.nests.nest.newTitle']()}
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button size="sm" onClick={submit} disabled={saving}>
                        {saving && <Spinner className="h-4 w-4" />}
                        {m['admin.nests.nest.create']()}
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                <Field label={m['admin.nests.nest.name']()} hint={m['admin.nests.nest.nameHint']()} htmlFor="nest-name">
                    <Input id="nest-name" autoFocus value={name} onChange={e => setName(e.currentTarget.value)} />
                </Field>
                <Field label={m['common.labels.description']()} htmlFor="nest-desc">
                    <Input id="nest-desc" value={description} onChange={e => setDescription(e.currentTarget.value)} />
                </Field>
                <Field label={m['admin.nests.nest.author']()} hint={m['admin.nests.nest.authorHint']()} htmlFor="nest-author">
                    <Input id="nest-author" type="email" value={author} onChange={e => setAuthor(e.currentTarget.value)} />
                </Field>
            </div>
        </Modal>
    );
}

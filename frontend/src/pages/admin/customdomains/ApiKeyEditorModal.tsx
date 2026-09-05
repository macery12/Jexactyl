import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { m } from '@/i18n/messages';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import {
    createCustomDomainApiKey,
    updateCustomDomainApiKey,
    type CustomDomainApiKey,
} from '@/api/adminCustomDomains';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { Spinner } from '@/components/ui/Spinner';

export function ApiKeyEditorModal({
    apiKey,
    onClose,
}: {
    apiKey: CustomDomainApiKey | null; // null → create
    onClose: () => void;
}) {
    const editing = apiKey !== null;
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();

    const [name, setName] = useState(apiKey?.name ?? '');
    const [token, setToken] = useState('');
    const [enabled, setEnabled] = useState(apiKey?.enabled ?? true);

    const save = useMutation({
        mutationFn: () => {
            if (editing) {
                return updateCustomDomainApiKey(apiKey.id, {
                    name: name.trim(),
                    token: token.trim() || undefined,
                    enabled,
                });
            }
            return createCustomDomainApiKey({ name: name.trim(), token: token.trim(), enabled });
        },
        onSuccess: () => {
            push({ type: 'success', message: m['common.states.saved']() });
            qc.invalidateQueries({ queryKey: ['admin', 'custom-domains', 'api-keys'] });
            onClose();
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const canSubmit = name.trim() !== '' && (editing || token.trim() !== '') && !save.isPending;

    return (
        <Modal
            open
            onClose={onClose}
            title={editing ? m['admin.customDomains.apiKeys.editTitle']() : m['admin.customDomains.apiKeys.createTitle']()}
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={save.isPending}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button size="sm" onClick={() => save.mutate()} disabled={!canSubmit}>
                        {save.isPending && <Spinner className="h-4 w-4" />}
                        {m['common.actions.save']()}
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                <Field label={m['admin.customDomains.apiKeys.nameLabel']()} htmlFor="ak-name">
                    <Input id="ak-name" value={name} onChange={e => setName(e.target.value)} autoComplete="off" />
                </Field>
                <Field
                    label={m['admin.customDomains.apiKeys.tokenLabel']()}
                    hint={editing ? m['admin.customDomains.apiKeys.tokenHintEdit']() : m['admin.customDomains.apiKeys.tokenHint']()}
                    htmlFor="ak-token"
                >
                    <Input
                        id="ak-token"
                        type="password"
                        value={token}
                        onChange={e => setToken(e.target.value)}
                        placeholder={editing ? m['admin.customDomains.apiKeys.tokenPlaceholderEdit']() : ''}
                        autoComplete="off"
                        spellCheck={false}
                    />
                </Field>
                <label className="flex items-center justify-between gap-4">
                    <span className="text-sm font-medium text-[var(--color-ink-muted)]">
                        {m['admin.customDomains.apiKeys.enabledLabel']()}
                    </span>
                    <Switch checked={enabled} onChange={setEnabled} />
                </label>
            </div>
        </Modal>
    );
}

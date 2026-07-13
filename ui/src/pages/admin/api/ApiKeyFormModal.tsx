import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, TriangleAlert } from 'lucide-react';
import { m, td } from '@/i18n';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { firstError } from '@/lib/apiError';
import {
    createAdminApiKey,
    API_KEY_RESOURCES,
    type ApiKeyPermissions,
    type ApiKeyPermissionValue,
    type ApiKeyResource,
} from '@/api/adminApiKeys';

const GRANTS: ApiKeyPermissionValue[] = ['0', '1', '2'];
const GRANT_LABEL: Record<ApiKeyPermissionValue, () => string> = {
    '0': () => m['admin.api.grant.none'](),
    '1': () => m['admin.api.grant.read'](),
    '2': () => m['admin.api.grant.readWrite'](),
};

function emptyPermissions(): ApiKeyPermissions {
    return Object.fromEntries(API_KEY_RESOURCES.map(r => [r, '0'])) as ApiKeyPermissions;
}

function PermissionRow({
    resource,
    value,
    onChange,
}: {
    resource: ApiKeyResource;
    value: ApiKeyPermissionValue;
    onChange: (v: ApiKeyPermissionValue) => void;
}) {
    return (
        <div className="flex flex-col gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 p-3 sm:flex-row sm:items-center sm:justify-between">
            <span className="text-sm font-medium text-[var(--color-ink)]">
                {td(`admin.api.resource.${resource}`, resource)}
            </span>
            <div className="flex overflow-hidden rounded-lg border border-[var(--color-border-strong)]">
                {GRANTS.map(g => (
                    <button
                        key={g}
                        type="button"
                        onClick={() => onChange(g)}
                        className={`px-3 py-1 text-xs font-medium transition-colors ${
                            value === g
                                ? 'bg-[var(--brand)] text-[var(--color-brand-ink)]'
                                : 'bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)]'
                        }`}
                    >
                        {GRANT_LABEL[g]()}
                    </button>
                ))}
            </div>
        </div>
    );
}

// Create dialog for an application API key. On success the full token is shown
// exactly once (it can never be recovered), with copy-to-clipboard.
export default function ApiKeyFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const qc = useQueryClient();

    const [memo, setMemo] = useState('');
    const [permissions, setPermissions] = useState<ApiKeyPermissions>(emptyPermissions);
    const [error, setError] = useState<string | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!open) return;
        setMemo('');
        setPermissions(emptyPermissions());
        setError(null);
        setToken(null);
        setCopied(false);
    }, [open]);

    const mutation = useMutation({
        mutationFn: () => createAdminApiKey(memo.trim(), permissions),
        onSuccess: async newToken => {
            setToken(newToken);
            await qc.invalidateQueries({ queryKey: ['admin', 'api-keys'] });
        },
        onError: err => setError(firstError(err) ?? m['common.states.genericError']()),
    });

    const setGrant = (resource: ApiKeyResource, value: ApiKeyPermissionValue) =>
        setPermissions(prev => ({ ...prev, [resource]: value }));

    const canSubmit = memo.trim().length >= 3;

    // Token-reveal view — replaces the form once the key is minted.
    if (token) {
        return (
            <Modal
                open={open}
                onClose={onClose}
                title={m['admin.api.tokenTitle']()}
                description={m['admin.api.tokenSubtitle']()}
                footer={
                    <Button size="sm" onClick={onClose}>
                        {m['common.actions.close']()}
                    </Button>
                }
            >
                <div className="flex flex-col gap-3">
                    <p className="flex items-start gap-2 rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3 py-2 text-sm text-[var(--color-warning)]">
                        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                        {m['admin.api.tokenWarning']()}
                    </p>
                    <div className="flex items-center gap-2">
                        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 font-mono text-sm text-[var(--color-ink)]">
                            {token}
                        </code>
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                                navigator.clipboard?.writeText(token).then(() => {
                                    setCopied(true);
                                    setTimeout(() => setCopied(false), 2000);
                                })
                            }
                        >
                            {copied ? <Check className="h-4 w-4 text-[var(--color-accent)]" /> : <Copy className="h-4 w-4" />}
                            {copied ? m['admin.api.copied']() : m['common.actions.copy']()}
                        </Button>
                    </div>
                </div>
            </Modal>
        );
    }

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={m['admin.api.createTitle']()}
            description={m['admin.api.createSubtitle']()}
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={mutation.isPending}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button size="sm" onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending}>
                        {mutation.isPending && <Spinner className="h-4 w-4" />}
                        {m['admin.api.create']()}
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

                <Field label={m['admin.api.form.memo']()} hint={m['admin.api.form.memoHint']()}>
                    <Input value={memo} onChange={e => setMemo(e.target.value)} autoComplete="off" maxLength={191} />
                </Field>

                <div>
                    <p className="mb-2 text-sm font-medium text-[var(--color-ink)]">{m['admin.api.form.permissions']()}</p>
                    <div className="flex flex-col gap-2">
                        {API_KEY_RESOURCES.map(resource => (
                            <PermissionRow
                                key={resource}
                                resource={resource}
                                value={permissions[resource]}
                                onChange={v => setGrant(resource, v)}
                            />
                        ))}
                    </div>
                </div>
            </div>
        </Modal>
    );
}

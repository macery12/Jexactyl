import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, TriangleAlert } from 'lucide-react';
import { m } from '@/i18n';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { firstError } from '@/lib/apiError';
import {
    ADMIN_API_KEY_RESOURCES,
    createAdminApiKey,
    emptyAdminApiKeyPermissions,
    type AdminApiKeyGrant,
    type AdminApiKeyPermissions,
    type AdminApiKeyResource,
} from '@/api/adminApiKeys';

// Create dialog for an application API key. On success the full token is shown
// exactly once (it can never be recovered), with copy-to-clipboard.
function resourceLabel(resource: AdminApiKeyResource): string {
    const labels: Record<AdminApiKeyResource, () => string> = {
        servers: m['admin.api.resource.r_servers'],
        nodes: m['admin.api.resource.r_nodes'],
        allocations: m['admin.api.resource.r_allocations'],
        users: m['admin.api.resource.r_users'],
        locations: m['admin.api.resource.r_locations'],
        nests: m['admin.api.resource.r_nests'],
        eggs: m['admin.api.resource.r_eggs'],
        database_hosts: m['admin.api.resource.r_database_hosts'],
        server_databases: m['admin.api.resource.r_server_databases'],
    };

    return labels[resource]();
}

const GRANTS: AdminApiKeyGrant[] = ['none', 'read', 'write'];

function grantLabel(grant: AdminApiKeyGrant): string {
    if (grant === 'read') return m['admin.api.grant.read']();
    if (grant === 'write') return m['admin.api.grant.readWrite']();
    return m['admin.api.grant.none']();
}

export default function ApiKeyFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const qc = useQueryClient();

    const [memo, setMemo] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [permissions, setPermissions] = useState<AdminApiKeyPermissions>(emptyAdminApiKeyPermissions);

    useEffect(() => {
        if (!open) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: syncs state to prop/query/filter changes
        setMemo('');
        setError(null);
        setToken(null);
        setCopied(false);
        setPermissions(emptyAdminApiKeyPermissions());
    }, [open]);

    const mutation = useMutation({
        mutationFn: () => createAdminApiKey(memo.trim(), permissions),
        onSuccess: async newToken => {
            setToken(newToken);
            await qc.invalidateQueries({ queryKey: ['admin', 'api-keys'] });
        },
        onError: err => setError(firstError(err) ?? m['common.states.genericError']()),
    });

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
            size="lg"
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
                    <p
                        role="alert"
                        className="rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]"
                    >
                        {error}
                    </p>
                )}

                <Field
                    htmlFor="admin-api-key-memo"
                    label={m['admin.api.form.memo']()}
                    hint={m['admin.api.form.memoHint']()}
                >
                    <Input
                        id="admin-api-key-memo"
                        value={memo}
                        onChange={e => setMemo(e.target.value)}
                        autoComplete="off"
                        maxLength={191}
                    />
                </Field>

                <div className="flex flex-col gap-2">
                    <div>
                        <h3 className="text-sm font-medium text-[var(--color-ink-muted)]">
                            {m['admin.api.form.permissions']()}
                        </h3>
                        <p className="mt-0.5 text-xs text-[var(--color-ink-faint)]">
                            {m['admin.api.permissionsHint']()}
                        </p>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                        {ADMIN_API_KEY_RESOURCES.map(resource => (
                            <fieldset
                                key={resource}
                                className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3"
                            >
                                <legend className="px-1 text-xs font-medium text-[var(--color-ink-muted)]">
                                    {resourceLabel(resource)}
                                </legend>
                                <div className="grid grid-cols-3 gap-1">
                                    {GRANTS.map(grant => (
                                        <label key={grant} className="cursor-pointer">
                                            <input
                                                className="peer sr-only"
                                                type="radio"
                                                name={`permission-${resource}`}
                                                value={grant}
                                                checked={permissions[resource] === grant}
                                                onChange={() =>
                                                    setPermissions(current => ({ ...current, [resource]: grant }))
                                                }
                                            />
                                            <span className="flex min-h-8 items-center justify-center rounded-md px-1.5 text-center text-xs text-[var(--color-ink-faint)] transition-colors peer-checked:bg-[var(--color-surface)] peer-checked:text-[var(--color-ink)] peer-focus-visible:ring-1 peer-focus-visible:ring-[var(--color-focus-ring)]">
                                                {grantLabel(grant)}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </fieldset>
                        ))}
                    </div>
                </div>
            </div>
        </Modal>
    );
}

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, TriangleAlert } from 'lucide-react';
import { m } from '@/i18n';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Spinner } from '@/components/ui/Spinner';
import { firstError } from '@/lib/apiError';
import { createApiKey } from '@/api/credentials';

// Create dialog for an account API key. On success the full token
// (identifier + secret) is shown exactly once — it can never be recovered —
// with copy-to-clipboard.
export default function ApiKeyCreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const qc = useQueryClient();

    const [description, setDescription] = useState('');
    const [allowedIps, setAllowedIps] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        if (!open) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: syncs state to prop/query/filter changes
        setDescription('');
        setAllowedIps('');
        setError(null);
        setToken(null);
        setCopied(false);
    }, [open]);

    const mutation = useMutation({
        mutationFn: () =>
            createApiKey(
                description.trim(),
                allowedIps
                    .split('\n')
                    .map(ip => ip.trim())
                    .filter(Boolean),
            ),
        onSuccess: async ({ token }) => {
            setToken(token);
            await qc.invalidateQueries({ queryKey: ['account', 'api-keys'] });
        },
        onError: err => setError(firstError(err) ?? m['common.states.genericError']()),
    });

    const canSubmit = description.trim().length >= 4;
    const revealed = token !== null;

    // One stable Modal for both phases (form → token reveal). Swapping the whole
    // <Modal> conditionally reconciled two very different trees onto the same
    // live Radix Dialog, desyncing its portal DOM ("insertBefore" crash). Here
    // the Dialog stays mounted and only the keyed body/footer swap as clean
    // subtree replacements.
    return (
        <Modal
            open={open}
            onClose={onClose}
            title={revealed ? m['account.credentials.api.tokenTitle']() : m['account.credentials.api.createTitle']()}
            description={revealed ? m['account.credentials.api.tokenSubtitle']() : m['account.credentials.api.createSubtitle']()}
            footer={
                revealed ? (
                    <Button key="reveal-footer" size="sm" onClick={onClose}>
                        {m['common.actions.close']()}
                    </Button>
                ) : (
                    <div key="form-footer" className="flex items-center gap-2">
                        <Button variant="ghost" size="sm" onClick={onClose} disabled={mutation.isPending}>
                            {m['common.actions.cancel']()}
                        </Button>
                        <Button size="sm" onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending}>
                            {mutation.isPending && <Spinner className="h-4 w-4" />}
                            {m['common.actions.create']()}
                        </Button>
                    </div>
                )
            }
        >
            {revealed ? (
                <div key="reveal" className="flex flex-col gap-3">
                    <p className="flex items-start gap-2 rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3 py-2 text-sm text-[var(--color-warning)]">
                        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                        {m['account.credentials.api.tokenWarning']()}
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
                            {copied ? (
                                <Check className="h-4 w-4 text-[var(--color-accent)]" />
                            ) : (
                                <Copy className="h-4 w-4" />
                            )}
                            {copied ? m['common.states.copied']() : m['common.actions.copy']()}
                        </Button>
                    </div>
                </div>
            ) : (
                <div key="form" className="flex flex-col gap-4">
                    {error && (
                        <p className="rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">
                            {error}
                        </p>
                    )}

                    <Field
                        label={m['account.credentials.api.form.description']()}
                        hint={m['account.credentials.api.form.descriptionHint']()}
                    >
                        <Input
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            autoComplete="off"
                            maxLength={500}
                        />
                    </Field>

                    <Field
                        label={m['account.credentials.api.form.allowedIps']()}
                        hint={m['account.credentials.api.form.allowedIpsHint']()}
                    >
                        <Textarea
                            value={allowedIps}
                            onChange={e => setAllowedIps(e.target.value)}
                            rows={4}
                            spellCheck={false}
                        />
                    </Field>
                </div>
            )}
        </Modal>
    );
}

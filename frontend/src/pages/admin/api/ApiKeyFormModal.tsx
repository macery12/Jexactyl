import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, Info, TriangleAlert } from 'lucide-react';
import { m } from '@/i18n';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Spinner } from '@/components/ui/Spinner';
import { firstError } from '@/lib/apiError';
import { createAdminApiKey } from '@/api/adminApiKeys';
import { getApiEligibleAccessProfiles } from '@/api/adminRoles';

// Create dialog for an application API key. On success the full token is shown
// exactly once (it can never be recovered), with copy-to-clipboard.
function permissionLabel(permission: string): string {
    return permission
        .split(/[.-]/)
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' · ');
}

export default function ApiKeyFormModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const qc = useQueryClient();

    const [memo, setMemo] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [token, setToken] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [accessProfileId, setAccessProfileId] = useState('');
    const [allowedIps, setAllowedIps] = useState('');
    const [expiresAt, setExpiresAt] = useState('');
    const [now, setNow] = useState(() => Date.now());

    const profilesQuery = useQuery({
        queryKey: ['admin', 'api-keys', 'access-profiles'],
        queryFn: getApiEligibleAccessProfiles,
        enabled: open && token === null,
        staleTime: 30_000,
    });

    useEffect(() => {
        if (!open) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: syncs state to prop/query/filter changes
        setMemo('');
        setError(null);
        setToken(null);
        setCopied(false);
        setAccessProfileId('');
        setAllowedIps('');
        setExpiresAt('');
        setNow(Date.now());
    }, [open]);

    const mutation = useMutation({
        mutationFn: () =>
            createAdminApiKey({
                memo: memo.trim(),
                accessProfileId: Number(accessProfileId),
                allowedIps: allowedIps
                    .split('\n')
                    .map(ip => ip.trim())
                    .filter(Boolean),
                expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
            }),
        onSuccess: async newToken => {
            setToken(newToken);
            await qc.invalidateQueries({ queryKey: ['admin', 'api-keys'] });
        },
        onError: err => setError(firstError(err) ?? m['common.states.genericError']()),
    });

    const canSubmit =
        memo.trim().length >= 3 &&
        Number.isInteger(Number(accessProfileId)) &&
        Number(accessProfileId) > 0 &&
        (!expiresAt || new Date(expiresAt).getTime() > now);

    const profileOptions = (profilesQuery.data ?? []).map(profile => ({
        value: String(profile.id),
        label: profile.name,
    }));
    const selectedProfile = (profilesQuery.data ?? []).find(profile => String(profile.id) === accessProfileId);

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

                <div className="grid gap-4 md:grid-cols-2">
                    <Field
                        htmlFor="admin-api-key-profile"
                        label={m['admin.access.keys.form.profile']()}
                        hint={m['admin.access.keys.form.profileHint']()}
                        error={
                            profilesQuery.isError
                                ? m['admin.access.keys.form.profileLoadError']()
                                : !profilesQuery.isLoading && profileOptions.length === 0
                                  ? m['admin.access.keys.form.noProfiles']()
                                  : undefined
                        }
                    >
                        <Select
                            id="admin-api-key-profile"
                            value={accessProfileId || undefined}
                            onChange={setAccessProfileId}
                            options={profileOptions}
                            placeholder={
                                profilesQuery.isLoading
                                    ? m['admin.access.keys.form.loadingProfiles']()
                                    : m['admin.access.keys.form.selectProfile']()
                            }
                            disabled={profilesQuery.isLoading || profilesQuery.isError || profileOptions.length === 0}
                            invalid={profilesQuery.isError}
                        />
                    </Field>

                    <Field
                        htmlFor="admin-api-key-expiry"
                        label={m['admin.access.keys.form.expires']()}
                        hint={m['admin.access.keys.form.expiresHint']()}
                    >
                        <Input
                            id="admin-api-key-expiry"
                            type="datetime-local"
                            value={expiresAt}
                            min={new Date(now + 60_000).toISOString().slice(0, 16)}
                            onChange={event => setExpiresAt(event.target.value)}
                        />
                    </Field>
                </div>

                <Field
                    htmlFor="admin-api-key-allowed-ips"
                    label={m['admin.access.keys.form.allowedIps']()}
                    hint={m['admin.access.keys.form.allowedIpsHint']()}
                >
                    <Textarea
                        id="admin-api-key-allowed-ips"
                        value={allowedIps}
                        onChange={event => setAllowedIps(event.target.value)}
                        rows={3}
                        spellCheck={false}
                        placeholder={'203.0.113.10\n2001:db8::/48'}
                    />
                </Field>

                <p className="flex items-start gap-2 rounded-lg border border-[var(--brand)]/25 bg-[var(--brand-soft)] px-3 py-2 text-xs text-[var(--color-ink-muted)]">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--brand)]" />
                    {m['admin.access.keys.form.authorityHint']()}
                </p>

                {selectedProfile && (
                    <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <h3 className="text-sm font-semibold text-[var(--color-ink)]">{selectedProfile.name}</h3>
                                <p className="mt-0.5 text-xs text-[var(--color-ink-faint)]">
                                    {selectedProfile.description || m['admin.access.keys.form.capabilitiesFallback']()}
                                </p>
                            </div>
                            <span className="shrink-0 text-xs font-medium text-[var(--color-ink-muted)]">
                                {m['admin.access.keys.form.capabilityCount']({
                                    count: selectedProfile.permissions.length,
                                })}
                            </span>
                        </div>
                        {selectedProfile.permissions.length > 0 ? (
                            <div className="mt-3 flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
                                {selectedProfile.permissions.map(permission => (
                                    <span
                                        key={permission}
                                        className="rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs text-[var(--color-ink-muted)]"
                                    >
                                        {permissionLabel(permission)}
                                    </span>
                                ))}
                            </div>
                        ) : (
                            <p className="mt-3 text-xs text-[var(--color-warning)]">
                                {m['admin.access.keys.form.noCapabilities']()}
                            </p>
                        )}
                    </section>
                )}
            </div>
        </Modal>
    );
}

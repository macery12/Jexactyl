import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe, Plus, Pencil, Trash2, KeyRound } from 'lucide-react';
import { m, td } from '@/i18n';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import {
    getAdminCustomDomains,
    deleteAdminCustomDomain,
    type AdminCustomDomain,
} from '@/api/adminCustomDomains';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { DomainEditorModal } from '../DomainEditorModal';

function Tag({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'accent' | 'muted' | 'warning' }) {
    const style =
        tone === 'accent'
            ? { backgroundColor: 'color-mix(in srgb, var(--color-accent) 15%, transparent)', color: 'var(--color-accent)' }
            : tone === 'warning'
              ? { backgroundColor: 'color-mix(in srgb, var(--color-warning) 15%, transparent)', color: 'var(--color-warning)' }
              : { backgroundColor: 'var(--color-surface-2)', color: 'var(--color-ink-faint)' };
    return (
        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold" style={style}>
            {children}
        </span>
    );
}

export default function DomainsPage() {
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();
    const key = ['admin', 'custom-domains', 'domains'];

    const { data, isLoading, isError } = useQuery({ queryKey: key, queryFn: getAdminCustomDomains });

    const [editor, setEditor] = useState<{ domain: AdminCustomDomain | null } | null>(null);
    const [toDelete, setToDelete] = useState<AdminCustomDomain | null>(null);

    const domains = data ?? [];

    const remove = useMutation({
        mutationFn: (id: number) => deleteAdminCustomDomain(id),
        onSuccess: () => {
            push({ type: 'success', message: m['admin.customDomains.domains.deleted']() });
            setToDelete(null);
            qc.invalidateQueries({ queryKey: key });
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="text-lg font-semibold text-[var(--color-ink)]">
                        {m['admin.customDomains.domains.title']()}
                    </h2>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                        {m['admin.customDomains.domains.subtitle']()}
                    </p>
                </div>
                <Button onClick={() => setEditor({ domain: null })}>
                    <Plus className="h-4 w-4" />
                    {m['admin.customDomains.domains.add']()}
                </Button>
            </div>

            <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]">
                {isLoading ? (
                    <div className="flex justify-center py-14">
                        <Spinner className="h-5 w-5" />
                    </div>
                ) : isError ? (
                    <p className="px-4 py-10 text-center text-sm text-[var(--color-danger)]">
                        {m['admin.customDomains.loadError']()}
                    </p>
                ) : domains.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
                        <Globe className="h-8 w-8 text-[var(--color-ink-faint)]" />
                        <p className="text-sm text-[var(--color-ink-muted)]">{m['admin.customDomains.domains.empty']()}</p>
                    </div>
                ) : (
                    <ul className="divide-y divide-[var(--color-border)]">
                        {domains.map(d => (
                            <li key={d.id} className="flex flex-wrap items-start gap-4 px-5 py-4">
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-mono text-sm text-[var(--color-ink)]">{d.domain}</span>
                                        {d.enabled ? (
                                            <Tag tone="accent">{td('common.states.enabled', 'Enabled')}</Tag>
                                        ) : (
                                            <Tag>{td('common.states.disabled', 'Disabled')}</Tag>
                                        )}
                                        {d.wildcardEnabled && <Tag tone="warning">{m['admin.customDomains.domains.wildcardBadge']()}</Tag>}
                                    </div>
                                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-ink-muted)]">
                                        <span className="inline-flex items-center gap-1">
                                            <KeyRound className="h-3.5 w-3.5" />
                                            {d.apiKeyName ?? m['admin.customDomains.domains.noApiKey']()}
                                        </span>
                                        <span>
                                            {d.allowedNestIds.length === 0 && d.allowedEggIds.length === 0
                                                ? m['admin.customDomains.domains.allGames']()
                                                : m['admin.customDomains.domains.restricted']({
                                                      nests: d.allowedNestIds.length,
                                                      eggs: d.allowedEggIds.length,
                                                  })}
                                        </span>
                                        {d.cloudflareZoneId && (
                                            <span className="font-mono text-[var(--color-ink-faint)]">
                                                {m['admin.customDomains.domains.zoneShort']({ zone: d.cloudflareZoneId })}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div className="flex items-center gap-1">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label={m['common.actions.edit']()}
                                        onClick={() => setEditor({ domain: d })}
                                    >
                                        <Pencil className="h-4 w-4" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label={m['common.actions.delete']()}
                                        className="text-[var(--color-danger)]"
                                        onClick={() => setToDelete(d)}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </Button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {editor && <DomainEditorModal domain={editor.domain} onClose={() => setEditor(null)} />}

            <ConfirmDialog
                open={!!toDelete}
                onClose={() => setToDelete(null)}
                title={m['admin.customDomains.domains.deleteTitle']()}
                body={m['admin.customDomains.domains.deleteBody']({ domain: toDelete?.domain ?? '' })}
                confirmLabel={m['common.actions.delete']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={remove.isPending}
                onConfirm={() => toDelete && remove.mutate(toDelete.id)}
            />
        </div>
    );
}

import { m } from '@/i18n';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { GitBranch, Plus, Pencil, Trash2, BadgeCheck, ExternalLink, X } from 'lucide-react';
import {
    type Repository,
    type RepositoryPayload,
    storeRepository,
    updateRepository,
    deleteRepository,
} from '@/api/extensions';
import { Panel } from '@/components/ui/Panel';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { Spinner } from '@/components/ui/Spinner';
import { useFlashes } from '@/state/flashes';
import { cn } from '@/lib/cn';

const tint = (v: string, pct: number) => `color-mix(in srgb, ${v} ${pct}%, transparent)`;

function statusVar(status?: string): string {
    if (status === 'ok') return 'var(--color-accent)';
    if (status === 'error') return 'var(--color-danger)';
    return 'var(--color-ink-faint)';
}

export function RepositoriesPanel({ repositories }: { repositories: Repository[] }) {
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();
    const [editing, setEditing] = useState<Repository | null>(null);
    const [adding, setAdding] = useState(false);

    const invalidate = () => {
        qc.invalidateQueries({ queryKey: ['admin', 'extension-repositories'] });
        qc.invalidateQueries({ queryKey: ['admin', 'extensions'] });
    };

    const toggle = useMutation({
        mutationFn: (repo: Repository) => updateRepository(repo.id, { name: repo.name, enabled: !repo.enabled }),
        onSuccess: invalidate,
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    const remove = useMutation({
        mutationFn: (id: number) => deleteRepository(id),
        onSuccess: () => {
            push({ type: 'success', message: m['extensions.toast.repoDeleted']() });
            invalidate();
        },
        onError: () => push({ type: 'error', message: m['common.states.genericError']() }),
    });

    return (
        <>
            <Panel
                title={m['extensions.repos.title']()}
                icon={GitBranch}
                right={
                    <button
                        type="button"
                        onClick={() => setAdding(true)}
                        className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] px-2.5 text-[11px] font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-2)]"
                    >
                        <Plus className="h-3.5 w-3.5" /> {m['extensions.repos.add']()}
                    </button>
                }
            >
                {repositories.length === 0 ? (
                    <p className="py-4 text-center text-xs text-[var(--color-ink-faint)]">{m['extensions.repos.empty']()}</p>
                ) : (
                    <ul className="divide-y divide-[var(--color-border)]">
                        {repositories.map(repo => {
                            const sv = statusVar(repo.status);
                            return (
                                <li key={repo.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                                    <span
                                        className="h-2 w-2 shrink-0 rounded-full"
                                        style={{ background: sv, boxShadow: `0 0 0 3px ${tint(sv, 18)}` }}
                                        aria-hidden
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <span className="truncate text-sm font-medium text-[var(--color-ink)]">
                                                {repo.name}
                                            </span>
                                            {repo.official && (
                                                <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--brand)]">
                                                    <BadgeCheck className="h-3 w-3" /> {m['extensions.repos.official']()}
                                                </span>
                                            )}
                                        </div>
                                        <p className="truncate font-mono text-[11px] text-[var(--color-ink-faint)]">
                                            {repo.manifestUrl}
                                        </p>
                                        {repo.status === 'error' && repo.error && (
                                            <p className="mt-0.5 truncate text-[11px] text-[var(--color-danger)]">{repo.error}</p>
                                        )}
                                    </div>
                                    <span className="hidden shrink-0 text-[11px] text-[var(--color-ink-muted)] sm:inline">
                                        {m['extensions.repos.packages']({ count: repo.packagesCount })}
                                    </span>
                                    <div className="flex shrink-0 items-center gap-1.5">
                                        <Switch
                                            checked={repo.enabled}
                                            disabled={toggle.isPending}
                                            onChange={() => toggle.mutate(repo)}
                                            label={repo.enabled ? m['extensions.repos.disable']() : m['extensions.repos.enable']()}
                                        />
                                        {repo.homepageUrl && (
                                            <a
                                                href={repo.homepageUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="rounded-md p-1.5 text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                                            >
                                                <ExternalLink className="h-3.5 w-3.5" />
                                            </a>
                                        )}
                                        {!repo.official && (
                                            <>
                                                <button
                                                    type="button"
                                                    onClick={() => setEditing(repo)}
                                                    aria-label={m['common.actions.edit']()}
                                                    className="rounded-md p-1.5 text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                                                >
                                                    <Pencil className="h-3.5 w-3.5" />
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={remove.isPending}
                                                    onClick={() => {
                                                        if (window.confirm(m['extensions.repos.deleteConfirm']({ name: repo.name })))
                                                            remove.mutate(repo.id);
                                                    }}
                                                    aria-label={m['common.actions.delete']()}
                                                    className="rounded-md p-1.5 text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-danger)]/10 hover:text-[var(--color-danger)] disabled:opacity-50"
                                                >
                                                    <Trash2 className="h-3.5 w-3.5" />
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </li>
                            );
                        })}
                    </ul>
                )}
            </Panel>

            {(adding || editing) && (
                <RepoFormModal
                    repo={editing}
                    onClose={() => {
                        setAdding(false);
                        setEditing(null);
                    }}
                    onSaved={() => {
                        push({ type: 'success', message: m['extensions.toast.repoSaved']() });
                        invalidate();
                        setAdding(false);
                        setEditing(null);
                    }}
                />
            )}
        </>
    );
}

function RepoFormModal({
    repo,
    onClose,
    onSaved,
}: {
    repo: Repository | null;
    onClose: () => void;
    onSaved: () => void;
}) {
    const push = useFlashes(s => s.push);
    const [name, setName] = useState(repo?.name ?? '');
    const [manifestUrl, setManifestUrl] = useState(repo?.manifestUrl ?? '');
    const [homepageUrl, setHomepageUrl] = useState(repo?.homepageUrl ?? '');
    const [enabled, setEnabled] = useState(repo?.enabled ?? true);
    // Only new repositories require the risk acknowledgement (the backend enforces
    // `acknowledge_risk` on store, not on update).
    const [acknowledgeRisk, setAcknowledgeRisk] = useState(false);
    const isNew = repo === null;

    const save = useMutation({
        mutationFn: () => {
            const payload: RepositoryPayload = {
                name: name.trim(),
                manifestUrl: manifestUrl.trim(),
                homepageUrl: homepageUrl.trim() || null,
                enabled,
                acknowledgeRisk,
            };
            return repo ? updateRepository(repo.id, payload) : storeRepository(payload);
        },
        onSuccess: onSaved,
        onError: (err: unknown) => {
            const msg =
                (err as { response?: { data?: { error?: string; errors?: Array<{ detail?: string }> } } })?.response?.data
                    ?.error ??
                (err as { response?: { data?: { errors?: Array<{ detail?: string }> } } })?.response?.data?.errors?.[0]
                    ?.detail ??
                m['common.states.genericError']();
            push({ type: 'error', message: msg });
        },
    });

    const valid = name.trim().length > 0 && manifestUrl.trim().length > 0 && (!isNew || acknowledgeRisk);

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
            <div
                role="dialog"
                aria-modal="true"
                style={{ borderRadius: 'var(--radius-card)' }}
                className="relative z-10 w-full max-w-md border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-2xl"
            >
                <header className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
                    <h3 className="text-sm font-semibold text-[var(--color-ink)]">
                        {repo ? m['extensions.repos.form.editTitle']() : m['extensions.repos.form.addTitle']()}
                    </h3>
                    <button
                        type="button"
                        onClick={onClose}
                        aria-label={m['common.actions.close']()}
                        className="rounded-lg p-1.5 text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </header>

                <form
                    onSubmit={e => {
                        e.preventDefault();
                        if (valid) save.mutate();
                    }}
                    className="space-y-3 p-4"
                >
                    <label className="block">
                        <span className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">
                            {m['extensions.repos.form.name']()}
                        </span>
                        <Input value={name} onChange={e => setName(e.target.value)} placeholder={m['extensions.repos.form.namePlaceholder']()} />
                    </label>
                    <label className="block">
                        <span className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">
                            {m['extensions.repos.form.manifestUrl']()}
                        </span>
                        <Input
                            value={manifestUrl}
                            onChange={e => setManifestUrl(e.target.value)}
                            placeholder={m['extensions.repos.form.manifestPlaceholder']()}
                        />
                    </label>
                    <label className="block">
                        <span className="mb-1 block text-xs font-medium text-[var(--color-ink-muted)]">
                            {m['extensions.repos.form.homepageUrl']()}
                        </span>
                        <Input
                            value={homepageUrl}
                            onChange={e => setHomepageUrl(e.target.value)}
                            placeholder={m['extensions.repos.form.homepagePlaceholder']()}
                        />
                    </label>
                    <div className="flex items-center justify-between rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-3 py-2.5">
                        <span className="text-xs text-[var(--color-ink-muted)]">{m['extensions.repos.form.enabled']()}</span>
                        <Switch checked={enabled} onChange={setEnabled} />
                    </div>

                    {isNew && (
                        <label
                            className="flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-xs leading-relaxed text-[var(--color-ink-muted)]"
                            style={{ borderColor: tint('var(--color-warning)', 35), background: tint('var(--color-warning)', 8) }}
                        >
                            <input
                                type="checkbox"
                                checked={acknowledgeRisk}
                                onChange={e => setAcknowledgeRisk(e.target.checked)}
                                className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-[var(--color-warning)]"
                            />
                            <span>{m['extensions.repos.form.acknowledgeRisk']()}</span>
                        </label>
                    )}

                    <div className="flex items-center justify-end gap-2 pt-1">
                        <button
                            type="button"
                            onClick={onClose}
                            className="inline-flex h-10 items-center rounded-lg px-4 text-sm font-medium text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                        >
                            {m['common.actions.cancel']()}
                        </button>
                        <button
                            type="submit"
                            disabled={!valid || save.isPending}
                            className={cn(
                                'inline-flex h-10 items-center gap-2 rounded-lg bg-[var(--brand)] px-5 text-sm font-medium text-[var(--color-brand-ink)] transition-colors hover:bg-[var(--brand-hover)]',
                                'disabled:opacity-50',
                            )}
                        >
                            {save.isPending && <Spinner className="h-4 w-4" />}
                            {save.isPending ? m['common.states.saving']() : m['extensions.repos.form.submit']()}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}

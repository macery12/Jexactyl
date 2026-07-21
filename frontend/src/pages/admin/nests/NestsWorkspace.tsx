import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Egg, ChevronRight, Copy, Upload, Trash2, Save } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import { firstError } from '@/lib/apiError';
import { useFlashes } from '@/state/flashes';
import { useWideContent } from '@/components/shell/shellLayout';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
    listNests,
    updateNest,
    deleteNest,
    listNestEggs,
    type AdminNest,
    type AdminEggListItem,
} from '@/api/adminNests';
import { NewNestModal } from './NewNestModal';
import { ImportEggModal } from './ImportEggModal';

export default function NestsWorkspace() {
    useWideContent();
    const { nestId } = useParams<{ nestId: string }>();
    const navigate = useNavigate();
    const [search, setSearch] = useState('');
    const [showNew, setShowNew] = useState(false);

    const { data: nests, isLoading } = useQuery({ queryKey: ['admin', 'nests'], queryFn: listNests });

    const filtered = useMemo(() => {
        const list = nests ?? [];
        const q = search.trim().toLowerCase();
        if (!q) return list;
        return list.filter(n => n.name.toLowerCase().includes(q) || (n.description ?? '').toLowerCase().includes(q));
    }, [nests, search]);

    const selectedId = nestId ? Number(nestId) : null;
    const selected = nests?.find(n => n.id === selectedId) ?? null;

    return (
        <div className="flex flex-col gap-4 lg:flex-row lg:gap-6">
            {/* Rail */}
            <aside className="flex w-full shrink-0 flex-col gap-3 lg:w-72">
                <div className="flex items-center justify-between">
                    <h1 className="text-lg font-semibold text-[var(--color-ink)]">{m['admin.nests.title']()}</h1>
                    <Button size="sm" onClick={() => setShowNew(true)}>
                        <Plus className="h-4 w-4" /> {m['admin.nests.nest.new']()}
                    </Button>
                </div>

                <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
                    <Input
                        className="h-9 pl-9"
                        placeholder={m['admin.nests.searchNests']()}
                        value={search}
                        onChange={e => setSearch(e.currentTarget.value)}
                    />
                </div>

                <div className="flex flex-col gap-1 overflow-y-auto rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]/60 p-1.5">
                    {isLoading ? (
                        <div className="flex items-center justify-center py-10">
                            <Spinner className="h-5 w-5" />
                        </div>
                    ) : filtered.length === 0 ? (
                        <p className="px-3 py-6 text-center text-xs text-[var(--color-ink-faint)]">
                            {m['admin.nests.noNests']()}
                        </p>
                    ) : (
                        filtered.map(nest => (
                            <button
                                key={nest.id}
                                onClick={() => navigate(`/admin/nests/${nest.id}`)}
                                className={cn(
                                    'flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                                    nest.id === selectedId
                                        ? 'bg-[var(--brand-soft)] text-[var(--color-ink)]'
                                        : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]',
                                )}
                            >
                                <Egg className="h-4 w-4 shrink-0 text-[var(--color-ink-faint)]" />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-medium">{nest.name}</span>
                                    <span className="block text-xs text-[var(--color-ink-faint)]">
                                        {m['admin.nests.eggCount']({ count: nest.eggCount })}
                                    </span>
                                </span>
                                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-ink-faint)]" />
                            </button>
                        ))
                    )}
                </div>
            </aside>

            {/* Detail */}
            <div className="min-w-0 flex-1">
                {selected ? (
                    <NestDetailPane key={selected.id} nest={selected} />
                ) : (
                    <div className="flex h-full min-h-[24rem] items-center justify-center rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-2)]/20 px-6 text-center text-sm text-[var(--color-ink-faint)]">
                        {m['admin.nests.selectPrompt']()}
                    </div>
                )}
            </div>

            {showNew && (
                <NewNestModal onClose={() => setShowNew(false)} onCreated={nest => navigate(`/admin/nests/${nest.id}`)} />
            )}
        </div>
    );
}

// ─── Nest detail pane ─────────────────────────────────────────────────────────

function NestDetailPane({ nest }: { nest: AdminNest }) {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const push = useFlashes(s => s.push);

    const [name, setName] = useState(nest.name);
    const [description, setDescription] = useState(nest.description ?? '');
    const [saving, setSaving] = useState(false);
    const [showDelete, setShowDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [showImport, setShowImport] = useState(false);
    const [eggSearch, setEggSearch] = useState('');

    const dirty = name !== nest.name || description !== (nest.description ?? '');

    const { data: eggs, isLoading: eggsLoading } = useQuery({
        queryKey: ['admin', 'nest-eggs', nest.id],
        queryFn: () => listNestEggs(nest.id),
    });

    const filteredEggs = useMemo(() => {
        const list = eggs ?? [];
        const q = eggSearch.trim().toLowerCase();
        if (!q) return list;
        return list.filter(e => e.name.toLowerCase().includes(q));
    }, [eggs, eggSearch]);

    const save = async () => {
        setSaving(true);
        try {
            await updateNest(nest.id, name.trim(), description.trim(), nest.author);
            queryClient.invalidateQueries({ queryKey: ['admin', 'nests'] });
            push({ type: 'success', message: m['admin.nests.nest.saved']() });
        } catch (err) {
            push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() });
        } finally {
            setSaving(false);
        }
    };

    const remove = async () => {
        setDeleting(true);
        try {
            await deleteNest(nest.id);
            queryClient.invalidateQueries({ queryKey: ['admin', 'nests'] });
            push({ type: 'success', message: m['admin.nests.nest.deleted']() });
            navigate('/admin/nests');
        } catch (err) {
            push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() });
            setDeleting(false);
            setShowDelete(false);
        }
    };

    const copy = (text: string) => {
        void navigator.clipboard?.writeText(text);
        push({ type: 'success', message: m['common.states.copied']() });
    };

    return (
        <div className="flex flex-col gap-5">
            {/* Edit + details */}
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <section className="rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70 p-5">
                    <h2 className="mb-4 text-sm font-semibold text-[var(--color-ink)]">{m['admin.nests.nest.editTitle']()}</h2>
                    <div className="flex flex-col gap-4">
                        <Field label={m['admin.nests.nest.name']()} htmlFor="edit-nest-name">
                            <Input id="edit-nest-name" value={name} onChange={e => setName(e.currentTarget.value)} />
                        </Field>
                        <Field label={m['common.labels.description']()} htmlFor="edit-nest-desc">
                            <Input id="edit-nest-desc" value={description} onChange={e => setDescription(e.currentTarget.value)} />
                        </Field>
                        <div className="flex items-center justify-between">
                            <Button variant="danger" size="sm" onClick={() => setShowDelete(true)}>
                                <Trash2 className="h-4 w-4" /> {m['admin.nests.nest.delete']()}
                            </Button>
                            <Button size="sm" onClick={save} disabled={!dirty || saving}>
                                {saving ? <Spinner className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                                {m['common.actions.saveChanges']()}
                            </Button>
                        </div>
                    </div>
                </section>

                <section className="rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70 p-5">
                    <h2 className="mb-4 text-sm font-semibold text-[var(--color-ink)]">{m['admin.nests.nest.detailsTitle']()}</h2>
                    <dl className="flex flex-col gap-3 text-sm">
                        <DetailRow label={m['admin.nests.nest.id']()} value={String(nest.id)} onCopy={() => copy(String(nest.id))} mono />
                        <DetailRow label={m['admin.nests.nest.uuid']()} value={nest.uuid} onCopy={() => copy(nest.uuid)} mono />
                        <DetailRow label={m['admin.nests.nest.author']()} value={nest.author} onCopy={() => copy(nest.author)} />
                        <div className="flex items-center justify-between">
                            <dt className="text-[var(--color-ink-faint)]">{m['admin.nests.nest.eggsInNest']()}</dt>
                            <dd className="text-[var(--color-ink)]">{nest.eggCount}</dd>
                        </div>
                    </dl>
                </section>
            </div>

            {/* Eggs table */}
            <section className="rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70">
                <header className="flex flex-wrap items-center gap-3 border-b border-[var(--color-border)] px-5 py-3.5">
                    <h2 className="text-sm font-semibold text-[var(--color-ink)]">{m['admin.nests.eggs.title']()}</h2>
                    <div className="relative ml-auto">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
                        <Input
                            className="h-9 w-48 pl-9"
                            placeholder={m['admin.nests.eggs.search']()}
                            value={eggSearch}
                            onChange={e => setEggSearch(e.currentTarget.value)}
                        />
                    </div>
                    <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
                        <Upload className="h-4 w-4" /> {m['admin.nests.eggs.import']()}
                    </Button>
                    <Button size="sm" onClick={() => navigate(`/admin/nests/${nest.id}/eggs/new`)}>
                        <Plus className="h-4 w-4" /> {m['admin.nests.eggs.new']()}
                    </Button>
                </header>

                {eggsLoading ? (
                    <div className="flex items-center justify-center py-14">
                        <Spinner className="h-6 w-6" />
                    </div>
                ) : filteredEggs.length === 0 ? (
                    <p className="px-6 py-12 text-center text-sm text-[var(--color-ink-faint)]">{m['admin.nests.eggs.empty']()}</p>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-[var(--color-border)] text-left text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
                                    <th className="w-16 px-5 py-2.5">{m['admin.nests.eggs.colId']()}</th>
                                    <th className="px-5 py-2.5">{m['admin.nests.eggs.colName']()}</th>
                                    <th className="w-24 px-5 py-2.5">{m['admin.nests.eggs.colVariables']()}</th>
                                    <th className="w-24 px-5 py-2.5">{m['admin.nests.eggs.colServers']()}</th>
                                    <th className="px-5 py-2.5">{m['common.labels.description']()}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredEggs.map((egg: AdminEggListItem) => (
                                    <tr
                                        key={egg.id}
                                        onClick={() => navigate(`/admin/nests/${nest.id}/eggs/${egg.id}`)}
                                        className="cursor-pointer border-b border-[var(--color-border)] transition-colors last:border-b-0 hover:bg-[var(--color-surface-2)]/40"
                                    >
                                        <td className="px-5 py-3">
                                            <code className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-xs text-[var(--color-ink-muted)]">
                                                {egg.id}
                                            </code>
                                        </td>
                                        <td className="px-5 py-3 font-medium text-[var(--brand)]">{egg.name}</td>
                                        <td className="px-5 py-3 text-[var(--color-ink-muted)]">{egg.variableCount}</td>
                                        <td className="px-5 py-3 text-[var(--color-ink-muted)]">{egg.serverCount}</td>
                                        <td className="px-5 py-3 text-[var(--color-ink-muted)]">
                                            {egg.description || (
                                                <span className="text-[var(--color-ink-faint)]">{m['admin.nests.eggs.noDescription']()}</span>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </section>

            {showImport && (
                <ImportEggModal
                    nestId={nest.id}
                    onClose={() => setShowImport(false)}
                    onImported={() => {
                        queryClient.invalidateQueries({ queryKey: ['admin', 'nest-eggs', nest.id] });
                        queryClient.invalidateQueries({ queryKey: ['admin', 'nests'] });
                    }}
                />
            )}

            <ConfirmDialog
                open={showDelete}
                onClose={() => setShowDelete(false)}
                title={m['admin.nests.nest.deleteTitle']()}
                body={m['admin.nests.nest.deleteBody']()}
                confirmLabel={m['admin.nests.nest.deleteConfirm']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={deleting}
                onConfirm={remove}
            />
        </div>
    );
}

function DetailRow({ label, value, onCopy, mono }: { label: string; value: string; onCopy: () => void; mono?: boolean }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <dt className="shrink-0 text-[var(--color-ink-faint)]">{label}</dt>
            <dd className="flex min-w-0 items-center gap-2">
                <span className={cn('truncate text-[var(--color-ink)]', mono && 'font-mono text-xs')}>{value}</span>
                <button
                    onClick={onCopy}
                    className="shrink-0 text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
                    aria-label={m['common.actions.copy']()}
                >
                    <Copy className="h-3.5 w-3.5" />
                </button>
            </dd>
        </div>
    );
}

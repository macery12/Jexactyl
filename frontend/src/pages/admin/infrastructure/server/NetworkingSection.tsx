import { m } from '@/i18n/messages';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Star, X, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { useServerView } from './ServerContext';
import { getNodeAllocations } from '@/api/nodes';

export interface AllocationDraft {
    primaryId: number | null;
    addIds: number[];
    removeIds: number[];
}

interface Row {
    id: number;
    label: string;
    staged: boolean;
}

export function NetworkingSection({ draft, onChange, readOnly }: { draft: AllocationDraft; onChange: (d: AllocationDraft) => void; readOnly: boolean }) {
    const s = useServerView();
    const [toAdd, setToAdd] = useState<string>();

    const freeQ = useQuery({
        queryKey: ['admin', 'node-allocations', String(s.nodeId)],
        queryFn: () => getNodeAllocations(s.nodeId),
    });
    const free = useMemo(() => (freeQ.data ?? []).filter(a => !a.isAssigned), [freeQ.data]);
    const freeById = useMemo(() => new Map(free.map(a => [a.id, a])), [free]);

    const fmt = (ip: string, port: number, alias: string | null) => (alias ? `${ip}:${port} (${alias})` : `${ip}:${port}`);

    // Current rows = kept server allocations + staged additions.
    const rows: Row[] = useMemo(() => {
        const kept: Row[] = s.allocations
            .filter(a => !draft.removeIds.includes(a.id))
            .map(a => ({ id: a.id, label: fmt(a.ip, a.port, a.alias), staged: false }));
        const added: Row[] = draft.addIds.map(id => {
            const a = freeById.get(id);
            return { id, label: a ? fmt(a.ip, a.port, a.alias) : `#${id}`, staged: true };
        });
        return [...kept, ...added];
    }, [s.allocations, draft, freeById]);

    const addOptions = free
        .filter(a => !draft.addIds.includes(a.id))
        .map(a => ({ value: String(a.id), label: fmt(a.ip, a.port, a.alias) }));

    const add = () => {
        if (!toAdd) return;
        const id = Number(toAdd);
        onChange({ ...draft, addIds: [...draft.addIds, id], primaryId: draft.primaryId ?? id });
        setToAdd(undefined);
    };

    const remove = (row: Row) => {
        let next: AllocationDraft;
        if (row.staged) {
            next = { ...draft, addIds: draft.addIds.filter(x => x !== row.id) };
        } else {
            next = { ...draft, removeIds: [...draft.removeIds, row.id] };
        }
        // If we removed the primary, reassign to the first remaining row.
        if (draft.primaryId === row.id) {
            const remaining = rows.filter(r => r.id !== row.id);
            next.primaryId = remaining[0]?.id ?? null;
        }
        onChange(next);
    };

    const setPrimary = (id: number) => onChange({ ...draft, primaryId: id });

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between text-xs text-[var(--color-ink-faint)]">
                <span className="font-semibold uppercase tracking-[0.14em]">{m['admin.infrastructure.serverDetail.net.current']()}</span>
                <span>
                    {m['admin.infrastructure.serverDetail.net.node']()}:{' '}
                    <Link to={`/admin/infrastructure/nodes/${s.nodeId}`} className="text-[var(--color-accent)] hover:underline">
                        {s.nodeName ?? `#${s.nodeId}`}
                    </Link>
                </span>
            </div>

            {rows.length === 0 ? (
                <p className="rounded-lg border border-dashed border-[var(--color-border-strong)] px-4 py-6 text-center text-sm text-[var(--color-ink-muted)]">
                    {m['admin.infrastructure.serverDetail.net.none']()}
                </p>
            ) : (
                <ul className="flex flex-col gap-2">
                    {rows.map(row => {
                        const primary = draft.primaryId === row.id;
                        return (
                            <li
                                key={row.id}
                                className={cn(
                                    'flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5',
                                    primary ? 'border-[var(--color-accent)]/50 bg-[var(--color-accent)]/5' : 'border-[var(--color-border)] bg-[var(--color-surface-2)]/40',
                                )}
                            >
                                <div className="flex min-w-0 items-center gap-2">
                                    <span className="font-mono text-sm tabular-nums text-[var(--color-ink)]">{row.label}</span>
                                    {primary && (
                                        <span className="inline-flex items-center gap-1 rounded-sm bg-[var(--color-accent)]/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-[var(--color-accent)]">
                                            <Star className="h-2.5 w-2.5 fill-current" /> {m['admin.infrastructure.serverDetail.net.primary']()}
                                        </span>
                                    )}
                                    {row.staged && <span className="text-[10px] uppercase tracking-wider text-[var(--color-warning)]">+ new</span>}
                                </div>
                                {!readOnly && (
                                    <div className="flex shrink-0 items-center gap-1">
                                        {!primary && (
                                            <button
                                                type="button"
                                                onClick={() => setPrimary(row.id)}
                                                title={m['admin.infrastructure.serverDetail.net.setPrimary']()}
                                                className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-accent)]"
                                            >
                                                <Star className="h-3.5 w-3.5" />
                                            </button>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => remove(row)}
                                            title={m['admin.infrastructure.serverDetail.net.remove']()}
                                            className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-danger)]"
                                        >
                                            <X className="h-3.5 w-3.5" />
                                        </button>
                                    </div>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}

            {!readOnly && (
                <div className="flex items-end gap-2">
                    <div className="min-w-0 flex-1">
                        <Select
                            value={toAdd}
                            onChange={setToAdd}
                            options={addOptions}
                            placeholder={addOptions.length === 0 ? m['admin.infrastructure.serverDetail.net.noFree']() : m['admin.infrastructure.serverDetail.net.addPlaceholder']()}
                            disabled={addOptions.length === 0}
                        />
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={add} disabled={!toAdd}>
                        <Plus className="h-4 w-4" /> {m['admin.infrastructure.serverDetail.net.add']()}
                    </Button>
                </div>
            )}
        </div>
    );
}

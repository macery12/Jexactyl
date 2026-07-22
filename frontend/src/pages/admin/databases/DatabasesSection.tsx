import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Database, Search } from 'lucide-react';
import { m } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { getDatabaseHosts, hostAddress, type DatabaseHost } from '@/api/adminDatabases';
import DatabaseEditor from './DatabaseEditor';
import HostStatus from './HostStatus';

type Selection = { mode: 'edit'; id: number } | { mode: 'new' } | null;

function RailRow({ host, active, onClick }: { host: DatabaseHost; active: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'flex w-full items-center gap-3 border-l-2 px-3 py-2.5 text-left transition-colors',
                active
                    ? 'border-[var(--brand)] bg-[var(--brand-soft)]'
                    : 'border-transparent hover:bg-[var(--color-surface-2)]',
            )}
        >
            <HostStatus host={host} />
            <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-[var(--color-ink)]">{host.name}</span>
                <span className="block truncate font-mono text-xs text-[var(--color-ink-faint)]">
                    {hostAddress(host)}
                </span>
            </span>
        </button>
    );
}

// Admin Databases — master–detail workspace for the Panel's database hosts (the
// MySQL connections servers provision databases onto). Left rail lists every
// host with a live reachability dot + address; the right pane edits the selected
// host or creates a new one. Full V1 parity for `/admin/databases`
// (list / search / create / edit / delete), backed by the existing Application
// API. No backend changes.
export default function DatabasesSection() {
    const { data: hosts, isLoading, isError } = useQuery({
        queryKey: ['admin', 'databases'],
        queryFn: getDatabaseHosts,
    });

    const [selection, setSelection] = useState<Selection>(null);
    const [query, setQuery] = useState('');

    // Auto-select the first host once loaded so the detail pane is never blank
    // when hosts exist; fall back to the create form on an empty list.
    useEffect(() => {
        if (!hosts || selection !== null) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: syncs state to prop/query/filter changes
        setSelection(hosts.length > 0 ? { mode: 'edit', id: hosts[0]!.id } : { mode: 'new' });
    }, [hosts, selection]);

    // A stale edit-selection (e.g. after a delete) collapses to the first host or new.
    useEffect(() => {
        if (selection?.mode === 'edit' && hosts && !hosts.some(h => h.id === selection.id)) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: syncs state to prop/query/filter changes
            setSelection(hosts.length > 0 ? { mode: 'edit', id: hosts[0]!.id } : { mode: 'new' });
        }
    }, [selection, hosts]);

    const selectedHost = useMemo(() => {
        if (!selection || selection.mode !== 'edit' || !hosts) return null;
        return hosts.find(h => h.id === selection.id) ?? null;
    }, [selection, hosts]);

    const filtered = useMemo(() => {
        if (!hosts) return [];
        const q = query.trim().toLowerCase();
        if (q.length < 2) return hosts;
        return hosts.filter(h => h.name.toLowerCase().includes(q) || h.host.toLowerCase().includes(q));
    }, [hosts, query]);

    const editorKey = selection?.mode === 'edit' ? `edit-${selection.id}` : 'new';

    return (
        <div className="flex flex-col gap-6">
            <header className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
                        <Database className="h-6 w-6 text-[var(--color-ink-muted)]" />
                        {m['admin.databases.title']()}
                    </h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.databases.subtitle']()}</p>
                </div>
                <Button size="sm" onClick={() => setSelection({ mode: 'new' })}>
                    <Plus className="h-4 w-4" />
                    {m['admin.databases.newHost']()}
                </Button>
            </header>

            <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
                {/* Rail */}
                <aside className="w-full shrink-0 lg:w-72">
                    <div className="relative mb-3">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
                        <Input
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder={m['admin.databases.searchPlaceholder']()}
                            className="pl-9"
                        />
                    </div>
                    <div
                        className="overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface)]"
                        style={{ borderRadius: 'var(--radius-card)' }}
                    >
                        {isLoading ? (
                            <div className="flex items-center justify-center py-12">
                                <Spinner className="h-5 w-5" />
                            </div>
                        ) : isError ? (
                            <p className="px-4 py-8 text-center text-sm text-[var(--color-danger)]">
                                {m['common.states.genericError']()}
                            </p>
                        ) : !hosts || hosts.length === 0 ? (
                            <p className="px-4 py-8 text-center text-sm text-[var(--color-ink-faint)]">
                                {m['admin.databases.empty']()}
                            </p>
                        ) : filtered.length === 0 ? (
                            <p className="px-4 py-8 text-center text-sm text-[var(--color-ink-faint)]">
                                {m['admin.databases.noMatches']()}
                            </p>
                        ) : (
                            <div className="flex flex-col divide-y divide-[var(--color-border)]">
                                {filtered.map(host => (
                                    <RailRow
                                        key={host.id}
                                        host={host}
                                        active={selection?.mode === 'edit' && selection.id === host.id}
                                        onClick={() => setSelection({ mode: 'edit', id: host.id })}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </aside>

                {/* Detail */}
                <div className="min-w-0 flex-1">
                    {selection === null ? (
                        <div className="flex items-center justify-center py-20 text-sm text-[var(--color-ink-faint)]">
                            <Spinner className="h-5 w-5" />
                        </div>
                    ) : (
                        <DatabaseEditor
                            key={editorKey}
                            host={selectedHost}
                            onSaved={saved => setSelection({ mode: 'edit', id: saved.id })}
                            onDeleted={() =>
                                setSelection(
                                    hosts && hosts.length > 1
                                        ? { mode: 'edit', id: hosts.find(h => h.id !== selectedHost?.id)!.id }
                                        : { mode: 'new' },
                                )
                            }
                            onCancel={() =>
                                setSelection(
                                    hosts && hosts.length > 0 ? { mode: 'edit', id: hosts[0]!.id } : { mode: 'new' },
                                )
                            }
                        />
                    )}
                </div>
            </div>
        </div>
    );
}

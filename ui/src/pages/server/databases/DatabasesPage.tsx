import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Database, Plus, Eye, Trash2 } from 'lucide-react';
import { m } from '@/i18n';
import { can } from '@/lib/can';
import { useServer } from '@/components/server/ServerContext';
import { getDatabases, connectionString, type ServerDatabase } from '@/api/databases';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import ConnectionModal from './ConnectionModal';
import CreateDatabaseModal from './CreateDatabaseModal';
import DeleteDatabaseModal from './DeleteDatabaseModal';

// Compact labelled cell used for the desktop-only columns on each row.
function Cell({ label, value }: { label: string; value: string }) {
    return (
        <div className="hidden min-w-0 text-center md:block">
            <p className="truncate font-mono text-sm text-[var(--color-ink)]">{value}</p>
            <p className="mt-0.5 text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)]">{label}</p>
        </div>
    );
}

export default function DatabasesPage() {
    const server = useServer();
    const held = server.permissions;
    const canCreate = can(held, 'database.create');
    const canDelete = can(held, 'database.delete');

    const { data, isLoading, isError } = useQuery({
        queryKey: ['server', server.id, 'databases'],
        queryFn: () => getDatabases(server.uuid),
    });

    const [viewing, setViewing] = useState<ServerDatabase | null>(null);
    const [deleting, setDeleting] = useState<ServerDatabase | null>(null);
    const [creating, setCreating] = useState(false);

    const databases = data ?? [];
    const limit = server.featureLimits.databases;
    // A limit of 0 means databases are disabled for this server entirely — unlike
    // the allocation limits elsewhere, 0 is not "unlimited" here.
    const disabled = limit === 0;
    const atLimit = !disabled && databases.length >= limit;

    // Keep the open connection modal pointed at fresh data so a password rotation
    // re-renders the new password rather than the one it opened with.
    const current = viewing ? (databases.find(d => d.id === viewing.id) ?? viewing) : null;

    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-xl font-semibold text-[var(--color-ink)]">{m['server.databases.title']()}</h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['server.databases.subtitle']()}</p>
                </div>
                {canCreate && !disabled && (
                    <div className="flex flex-col items-end gap-1">
                        <Button onClick={() => setCreating(true)} disabled={atLimit}>
                            <Plus className="h-4 w-4" />
                            {m['server.databases.addDatabase']()}
                        </Button>
                        <span className="text-xs text-[var(--color-ink-faint)]">
                            {m['server.databases.limit']({ used: databases.length, total: limit })}
                        </span>
                    </div>
                )}
            </div>

            <div className="overflow-hidden rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]">
                {isLoading ? (
                    <div className="flex justify-center py-14">
                        <Spinner className="h-5 w-5" />
                    </div>
                ) : isError ? (
                    <p className="px-4 py-10 text-center text-sm text-[var(--color-danger)]">
                        {m['server.databases.loadError']()}
                    </p>
                ) : databases.length === 0 ? (
                    <div className="flex flex-col items-center gap-3 px-4 py-14 text-center">
                        <Database className="h-8 w-8 text-[var(--color-ink-faint)]" />
                        <p className="text-sm text-[var(--color-ink-muted)]">
                            {disabled ? m['server.databases.notAllowed']() : m['server.databases.empty']()}
                        </p>
                    </div>
                ) : (
                    <ul className="divide-y divide-[var(--color-border)]">
                        {databases.map(db => (
                            <li key={db.id} className="flex items-center gap-4 px-5 py-4">
                                <Database className="hidden h-4 w-4 shrink-0 text-[var(--color-ink-faint)] md:block" />
                                <p className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-ink)]">
                                    {db.name}
                                </p>
                                <Cell label={m['server.databases.endpoint']()} value={connectionString(db)} />
                                <Cell label={m['server.databases.connectionsFrom']()} value={db.connectionsFrom} />
                                <Cell label={m['server.databases.username']()} value={db.username} />
                                <div className="flex shrink-0 items-center gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => setViewing(db)}
                                        title={m['server.databases.viewConnection']()}
                                    >
                                        <Eye className="h-4 w-4" />
                                        <span className="hidden sm:inline">
                                            {m['server.databases.viewConnection']()}
                                        </span>
                                    </Button>
                                    {canDelete && (
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            onClick={() => setDeleting(db)}
                                            title={m['common.actions.delete']()}
                                            className="text-[var(--color-danger)]"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                        </Button>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            {current && <ConnectionModal database={current} onClose={() => setViewing(null)} />}
            {deleting && <DeleteDatabaseModal database={deleting} onClose={() => setDeleting(null)} />}
            {creating && <CreateDatabaseModal onClose={() => setCreating(false)} />}
        </div>
    );
}

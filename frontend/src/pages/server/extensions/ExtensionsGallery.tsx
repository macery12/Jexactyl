import { createElement } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Puzzle } from 'lucide-react';
import { m } from '@/i18n';
import { useServer } from '@/components/server/ServerContext';
import { getServerExtensions, type ServerExtension } from '@/api/serverExtensions';
import { Spinner } from '@/components/ui/Spinner';
import { extensionIcon } from './icons';

// Browsable catalog of the extensions enabled for this server. The API already
// filters by the server's egg and the subuser's disabled_extensions list, so
// whatever comes back is exactly what this user may open.
export default function ExtensionsGallery() {
    const server = useServer();

    const { data, isLoading, isError } = useQuery({
        queryKey: ['server', server.id, 'extensions'],
        queryFn: () => getServerExtensions(server.uuid),
    });

    return (
        <div className="flex flex-col gap-4">
            <div>
                <h1 className="text-xl font-semibold text-[var(--color-ink)]">{m['server.extensions.title']()}</h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['server.extensions.subtitle']()}</p>
            </div>

            {isLoading ? (
                <div className="flex justify-center py-16">
                    <Spinner className="h-7 w-7" />
                </div>
            ) : isError ? (
                <EmptyState title={m['common.states.error']()} body={m['common.states.genericError']()} />
            ) : (data ?? []).length === 0 ? (
                <EmptyState title={m['server.extensions.emptyTitle']()} body={m['server.extensions.emptyBody']()} />
            ) : (
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {data!.map(extension => (
                        <ExtensionCard key={extension.id} extension={extension} serverId={server.id} />
                    ))}
                </div>
            )}
        </div>
    );
}

function ExtensionCard({ extension, serverId }: { extension: ServerExtension; serverId: string }) {
    const iconEl = createElement(extensionIcon(extension.icon), { className: 'h-4.5 w-4.5' });

    return (
        <Link
            to={`/server/${serverId}/extensions/${extension.route}`}
            className="group flex flex-col rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70 p-4 transition-colors hover:border-[var(--brand)]/50 hover:bg-[var(--color-surface-2)]"
        >
            <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--brand-soft)] text-[var(--brand)]">
                    {iconEl}
                </div>
                <div className="min-w-0 flex-1">
                    {/* Manifest copy — rendered verbatim, not catalogued. */}
                    <h2 className="truncate text-sm font-semibold text-[var(--color-ink)]">{extension.name}</h2>
                    <p className="font-mono text-[11px] tabular-nums text-[var(--color-ink-faint)]">
                        {m['server.extensions.version']({ version: extension.version })}
                    </p>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-ink-faint)] transition-transform group-hover:translate-x-0.5" />
            </div>
            {extension.description && (
                <p className="mt-3 line-clamp-2 text-xs text-[var(--color-ink-muted)]">{extension.description}</p>
            )}
        </Link>
    );
}

function EmptyState({ title, body }: { title: string; body: string }) {
    return (
        <div className="flex flex-col items-center rounded-[var(--radius-card)] border border-[var(--color-border)] bg-[var(--color-surface)]/70 px-6 py-14 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-ink-faint)]">
                <Puzzle className="h-5 w-5" />
            </div>
            <p className="mt-4 text-sm font-medium text-[var(--color-ink)]">{title}</p>
            <p className="mt-1 max-w-sm text-xs text-[var(--color-ink-muted)]">{body}</p>
        </div>
    );
}

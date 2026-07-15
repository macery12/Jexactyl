import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Link2, Search, Eye, EyeOff } from 'lucide-react';
import { m } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { getLinks, linkHost, type CustomLink } from '@/api/adminLinks';
import LinkEditor from './LinkEditor';

type Selection = { mode: 'edit'; id: number } | { mode: 'new' } | null;

function RailRow({ link, active, onClick }: { link: CustomLink; active: boolean; onClick: () => void }) {
    const Visibility = link.visible ? Eye : EyeOff;
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
            <Visibility
                className={cn(
                    'h-4 w-4 shrink-0',
                    link.visible ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink-faint)]',
                )}
                aria-label={link.visible ? m['admin.links.visible']() : m['admin.links.hidden']()}
            />
            <span className="min-w-0 flex-1">
                <span
                    className={cn(
                        'block truncate text-sm font-medium',
                        link.visible ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-faint)]',
                    )}
                >
                    {link.name}
                </span>
                <span className="block truncate font-mono text-xs text-[var(--color-ink-faint)]">
                    {linkHost(link.url)}
                </span>
            </span>
        </button>
    );
}

// Admin Links — master–detail workspace for the operator-defined external links
// shown to end users in the sidebar. Left rail lists every link with its
// visibility state + host; the right pane edits the selected link or creates a
// new one. Full V1 parity for `/admin/links` (list / search / create / edit /
// delete), backed by the existing Application API. No backend changes.
export default function LinksSection() {
    const { data: links, isLoading, isError } = useQuery({
        queryKey: ['admin', 'links'],
        queryFn: getLinks,
    });

    const [selection, setSelection] = useState<Selection>(null);
    const [query, setQuery] = useState('');

    // Auto-select the first link once loaded so the detail pane is never blank
    // when links exist; fall back to the create form on an empty list.
    useEffect(() => {
        if (!links || selection !== null) return;
        setSelection(links.length > 0 ? { mode: 'edit', id: links[0]!.id } : { mode: 'new' });
    }, [links, selection]);

    // A stale edit-selection (e.g. after a delete) collapses to the first link or new.
    useEffect(() => {
        if (selection?.mode === 'edit' && links && !links.some(l => l.id === selection.id)) {
            setSelection(links.length > 0 ? { mode: 'edit', id: links[0]!.id } : { mode: 'new' });
        }
    }, [selection, links]);

    const selectedLink = useMemo(() => {
        if (!selection || selection.mode !== 'edit' || !links) return null;
        return links.find(l => l.id === selection.id) ?? null;
    }, [selection, links]);

    // Mirrors V1's search: name or URL, ignored under two characters.
    const filtered = useMemo(() => {
        if (!links) return [];
        const q = query.trim().toLowerCase();
        if (q.length < 2) return links;
        return links.filter(l => l.name.toLowerCase().includes(q) || l.url.toLowerCase().includes(q));
    }, [links, query]);

    const editorKey = selection?.mode === 'edit' ? `edit-${selection.id}` : 'new';

    return (
        <div className="flex flex-col gap-6">
            <header className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
                        <Link2 className="h-6 w-6 text-[var(--color-ink-muted)]" />
                        {m['admin.links.title']()}
                    </h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.links.subtitle']()}</p>
                </div>
                <Button size="sm" onClick={() => setSelection({ mode: 'new' })}>
                    <Plus className="h-4 w-4" />
                    {m['admin.links.newLink']()}
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
                            placeholder={m['admin.links.searchPlaceholder']()}
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
                        ) : !links || links.length === 0 ? (
                            <p className="px-4 py-8 text-center text-sm text-[var(--color-ink-faint)]">
                                {m['admin.links.empty']()}
                            </p>
                        ) : filtered.length === 0 ? (
                            <p className="px-4 py-8 text-center text-sm text-[var(--color-ink-faint)]">
                                {m['admin.links.noMatches']()}
                            </p>
                        ) : (
                            <div className="flex flex-col divide-y divide-[var(--color-border)]">
                                {filtered.map(link => (
                                    <RailRow
                                        key={link.id}
                                        link={link}
                                        active={selection?.mode === 'edit' && selection.id === link.id}
                                        onClick={() => setSelection({ mode: 'edit', id: link.id })}
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
                        <LinkEditor
                            key={editorKey}
                            link={selectedLink}
                            onSaved={id => setSelection({ mode: 'edit', id })}
                            onDeleted={() =>
                                setSelection(
                                    links && links.length > 1
                                        ? { mode: 'edit', id: links.find(l => l.id !== selectedLink?.id)!.id }
                                        : { mode: 'new' },
                                )
                            }
                            onCancel={() =>
                                setSelection(
                                    links && links.length > 0 ? { mode: 'edit', id: links[0]!.id } : { mode: 'new' },
                                )
                            }
                        />
                    )}
                </div>
            </div>
        </div>
    );
}

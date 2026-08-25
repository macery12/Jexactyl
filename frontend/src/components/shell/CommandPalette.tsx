import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { Search, CornerDownLeft, type LucideIcon } from 'lucide-react';
import { m, td } from '@/i18n/messages';
import { useFlags } from '@/state/flags';
import { useAdminHeld } from '@/layouts/heldPermissions';
import { adminRoutes } from '@/routes/admin.routes';
import { buildNav } from '@/routes/nav';
import { COMMAND_ACTIONS, type CommandGroup } from './commandRegistry';
import { can } from '@/lib/can';
import { cn } from '@/lib/cn';

// Command palette (Cmd/Ctrl + K) — the modern replacement for V1's floating
// "speed dial". Two halves:
//   • Actions — the curated create/deep-link commands in commandRegistry.ts.
//   • Go to   — every admin destination, generated from the route registry via
//               buildNav, so new admin pages appear here for free.
// Both halves are permission- and feature-flag filtered, so the palette can only
// ever offer somewhere the viewer can actually go.
//
// Built on Radix Dialog rather than ui/Modal: that component intentionally
// blocks ESC and outside-click to protect half-filled forms, which is exactly
// the wrong behaviour for a throwaway launcher.

type EntryGroup = CommandGroup | 'goto';

interface Entry {
    id: string;
    label: string;
    icon?: LucideIcon;
    to: string;
    group: EntryGroup;
    /** Lower-cased haystack for matching (label + English name + keywords). */
    search: string;
}

const GROUP_ORDER: EntryGroup[] = ['create', 'open', 'goto'];

// Only affects the hint printed on the trigger; the handler accepts either
// modifier regardless of what we guess here.
const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

export function CommandPalette() {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const navigate = useNavigate();
    const flags = useFlags(s => s.everest);
    const held = useAdminHeld();
    const listRef = useRef<HTMLDivElement>(null);

    // Global hotkey. Registered once for as long as the palette is mounted —
    // TopNav only mounts it for admins with the feature enabled, so there's no
    // stray listener for everyone else.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                // Always open on a fresh query; harmless when this toggles shut.
                setQuery('');
                setActive(0);
                setOpen(o => !o);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    // Every entry the viewer may see, before the query filter.
    const entries = useMemo<Entry[]>(() => {
        const out: Entry[] = [];

        for (const a of COMMAND_ACTIONS) {
            if (a.condition && flags && !a.condition(flags)) continue;
            if (a.permission && !can(held, a.permission)) continue;
            const label = td(`nav.commands.${a.id}`, a.name);
            out.push({
                id: `action:${a.id}`,
                label,
                icon: a.icon,
                to: a.to,
                group: a.group,
                search: `${label} ${a.name} ${a.keywords ?? ''}`.toLowerCase(),
            });
        }

        // "Go to" is generated, so it tracks the route registry automatically.
        for (const group of buildNav(adminRoutes, { flags, held, basePath: '/admin' })) {
            for (const item of group.items) {
                const label = td(`nav.items.${item.name}`, item.name);
                const category = group.category ? td(`nav.category.${group.category}`, group.category) : '';
                out.push({
                    id: `goto:${item.to}`,
                    label,
                    icon: item.icon,
                    to: item.to,
                    group: 'goto',
                    search: `${label} ${item.name} ${category}`.toLowerCase(),
                });
            }
        }

        return out;
    }, [flags, held]);

    const results = useMemo(() => {
        const q = query.trim().toLowerCase();
        const matched = q ? entries.filter(e => e.search.includes(q)) : entries;
        // Stable group ordering; within a group, registry order is preserved.
        return [...matched].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
    }, [entries, query]);

    // Clamp rather than reset-in-an-effect: the candidate list shrinks as the
    // query narrows, and a stored index past the end must never let Enter fire a
    // row that isn't on screen.
    const activeIndex = Math.min(active, Math.max(0, results.length - 1));

    // Keep the highlighted row in view during keyboard navigation.
    useEffect(() => {
        listRef.current
            ?.querySelector(`[data-index="${activeIndex}"]`)
            ?.scrollIntoView({ block: 'nearest' });
    }, [activeIndex]);

    const run = useCallback(
        (entry: Entry | undefined) => {
            if (!entry) return;
            setOpen(false);
            setQuery('');
            navigate(entry.to);
        },
        [navigate],
    );

    const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive(i => (results.length === 0 ? 0 : (i + 1) % results.length));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive(i => (results.length === 0 ? 0 : (i - 1 + results.length) % results.length));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            run(results[activeIndex]);
        }
    };

    const groupLabel = (g: EntryGroup) => td(`nav.commandPalette.group.${g}`, g);

    let rendered = -1; // running flat index, so keyboard nav lines up with the DOM

    return (
        <Dialog.Root
            open={open}
            onOpenChange={next => {
                setOpen(next);
                setQuery('');
                setActive(0);
            }}
        >
            <Dialog.Trigger
                className={cn(
                    'hidden items-center gap-2 rounded-lg px-3 py-2 text-sm sm:inline-flex',
                    'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]',
                )}
                aria-label={m['nav.commandPalette.title']()}
            >
                <Search className="h-4 w-4" />
                <span className="hidden xl:inline">{m['nav.commandPalette.trigger']()}</span>
                <kbd className="hidden rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-ink-faint)] xl:block">
                    {IS_MAC ? '⌘K' : 'Ctrl K'}
                </kbd>
            </Dialog.Trigger>

            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm" />
                <Dialog.Content
                    className={cn(
                        'fixed left-1/2 top-[12vh] z-50 flex max-h-[70vh] w-[calc(100vw-2rem)] max-w-xl -translate-x-1/2 flex-col overflow-hidden',
                        'rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-2xl shadow-black/40',
                        'focus:outline-none',
                    )}
                >
                    <Dialog.Title className="sr-only">{m['nav.commandPalette.title']()}</Dialog.Title>
                    <Dialog.Description className="sr-only">
                        {m['nav.commandPalette.description']()}
                    </Dialog.Description>

                    <div className="flex items-center gap-3 border-b border-[var(--color-border)] px-4">
                        <Search className="h-4 w-4 shrink-0 text-[var(--color-ink-faint)]" />
                        {/* A launcher that doesn't focus its input is useless. */}
                        <input
                            autoFocus
                            value={query}
                            onChange={e => {
                                setQuery(e.target.value);
                                setActive(0);
                            }}
                            onKeyDown={onInputKeyDown}
                            placeholder={m['nav.commandPalette.placeholder']()}
                            className="h-14 min-w-0 flex-1 bg-transparent text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:outline-none"
                        />
                        <kbd className="hidden shrink-0 rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--color-ink-faint)] sm:block">
                            ESC
                        </kbd>
                    </div>

                    <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
                        {results.length === 0 ? (
                            <p className="px-3 py-8 text-center text-sm text-[var(--color-ink-muted)]">
                                {m['nav.commandPalette.empty']()}
                            </p>
                        ) : (
                            GROUP_ORDER.map(group => {
                                const items = results.filter(r => r.group === group);
                                if (items.length === 0) return null;
                                return (
                                    <div key={group} className="mb-1 last:mb-0">
                                        <p className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
                                            {groupLabel(group)}
                                        </p>
                                        {items.map(entry => {
                                            rendered += 1;
                                            const index = rendered;
                                            const isActive = index === activeIndex;
                                            return (
                                                <button
                                                    key={entry.id}
                                                    type="button"
                                                    data-index={index}
                                                    onClick={() => run(entry)}
                                                    onMouseMove={() => setActive(index)}
                                                    className={cn(
                                                        'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors',
                                                        isActive
                                                            ? 'bg-[var(--color-surface-2)] text-[var(--color-ink)]'
                                                            : 'text-[var(--color-ink-muted)]',
                                                    )}
                                                >
                                                    {entry.icon && <entry.icon className="h-4 w-4 shrink-0" />}
                                                    <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                                                    {isActive && (
                                                        <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-faint)]" />
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}

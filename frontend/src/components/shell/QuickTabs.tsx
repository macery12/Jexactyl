import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronDown } from 'lucide-react';
import { td } from '@/i18n';
import { useFlags } from '@/state/flags';
import { useAdminHeld } from '@/layouts/heldPermissions';
import { visibleQuickTabs } from '@/routes/quickTabs';
import { cn } from '@/lib/cn';

// Quick Tabs — predefined admin shortcut menus in the top bar. Each tab is a
// category button that opens a dropdown of destinations (see routes/quickTabs.ts
// for the curated set). Entries are filtered per viewer, so a tab with nothing
// left in it disappears entirely rather than opening an empty menu.
//
// Large screens only: the top bar has no room for these next to the brand mark,
// the admin toggle and the avatar on mobile, and the sidebar already covers the
// same ground there.
export function QuickTabs() {
    const flags = useFlags(s => s.everest);
    const held = useAdminHeld();
    const location = useLocation();

    const tabs = useMemo(() => visibleQuickTabs(flags, held), [flags, held]);

    if (tabs.length === 0) return null;

    // Highlight the tab owning the current page so the top bar reflects where
    // you are, the way the sidebar's active NavLink does.
    const isActiveTab = (paths: string[]) =>
        paths.some(p => location.pathname === p || location.pathname.startsWith(`${p}/`));

    return (
        <div className="hidden items-center gap-1 lg:flex">
            {tabs.map(tab => {
                const active = isActiveTab(tab.items.map(i => i.to));
                return (
                    <DropdownMenu.Root key={tab.key}>
                        <DropdownMenu.Trigger
                            className={cn(
                                'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                                'data-[state=open]:bg-[var(--color-surface-2)]',
                                active
                                    ? 'text-[var(--color-ink)]'
                                    : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]',
                            )}
                        >
                            <tab.icon className="h-4 w-4 shrink-0" />
                            <span>{td(`nav.quickTabs.${tab.key}`, tab.name)}</span>
                            <ChevronDown className="h-3.5 w-3.5 text-[var(--color-ink-faint)]" />
                        </DropdownMenu.Trigger>
                        <DropdownMenu.Portal>
                            <DropdownMenu.Content
                                align="start"
                                sideOffset={8}
                                className="z-50 min-w-52 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-1.5 shadow-xl"
                            >
                                {tab.items.map(item => (
                                    <DropdownMenu.Item key={item.to} asChild>
                                        <Link
                                            to={item.to}
                                            className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-[var(--color-ink-muted)] outline-none hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] focus:bg-[var(--color-surface-2)] focus:text-[var(--color-ink)]"
                                        >
                                            <item.icon className="h-4 w-4 shrink-0" />
                                            <span className="truncate">{td(`nav.items.${item.name}`, item.name)}</span>
                                        </Link>
                                    </DropdownMenu.Item>
                                ))}
                            </DropdownMenu.Content>
                        </DropdownMenu.Portal>
                    </DropdownMenu.Root>
                );
            })}
        </div>
    );
}

import { useMemo, useState, Suspense, type ReactNode } from 'react';
import { Outlet } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { TopNav } from './TopNav';
import { Sidebar } from './Sidebar';
import { FullPageSpinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { ShellLayoutContext } from './shellLayout';
import type { NavGroup } from '@/routes/nav';

// Shared chrome for all authenticated areas: top nav + a registry-driven
// sidebar (desktop static, mobile drawer) + the routed content. An optional
// `header` slot renders a sticky band above the routed content (the server
// area uses it for the server-identity bar).
export function AppShell({ groups, header }: { groups: NavGroup[]; header?: ReactNode }) {
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [wide, setWide] = useState(false);
    const layout = useMemo(() => ({ setWide }), []);

    return (
        <ShellLayoutContext.Provider value={layout}>
        <div className="flex min-h-screen flex-col">
            <TopNav onToggleSidebar={() => setDrawerOpen(true)} />

            <div className="flex flex-1">
                <aside className="hidden w-64 shrink-0 border-r border-[var(--color-border)] bg-[var(--sidebar)]/50 lg:block">
                    <div className="sticky top-16">
                        <Sidebar groups={groups} />
                    </div>
                </aside>

                <Dialog.Root open={drawerOpen} onOpenChange={setDrawerOpen}>
                    <Dialog.Portal>
                        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden" />
                        <Dialog.Content className="fixed inset-y-0 left-0 z-50 w-72 overflow-y-auto border-r border-[var(--color-border-strong)] bg-[var(--color-surface)] lg:hidden">
                            <div className="flex h-16 items-center justify-between px-4">
                                <Dialog.Title className="text-sm font-semibold">Navigation</Dialog.Title>
                                <Dialog.Close className="flex h-9 w-9 items-center justify-center rounded-lg text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)]">
                                    <X className="h-5 w-5" />
                                </Dialog.Close>
                            </div>
                            <Sidebar groups={groups} onNavigate={() => setDrawerOpen(false)} />
                        </Dialog.Content>
                    </Dialog.Portal>
                </Dialog.Root>

                <main className="min-w-0 flex-1">
                    {header && (
                        <div className="sticky top-16 z-20 border-b border-[var(--color-border)] bg-[var(--canvas)]/85 px-5 py-4 backdrop-blur sm:px-8">
                            <div className="mx-auto w-full max-w-6xl">{header}</div>
                        </div>
                    )}
                    <div className="px-5 py-6 sm:px-8">
                        <div className={cn('mx-auto w-full', wide ? 'max-w-[104rem]' : 'max-w-6xl')}>
                            <Suspense fallback={<FullPageSpinner />}>
                                <Outlet />
                            </Suspense>
                        </div>
                    </div>
                </main>
            </div>
        </div>
        </ShellLayoutContext.Provider>
    );
}

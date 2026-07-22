import { m } from '@/i18n';
import { Link, useLocation } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Menu, ChevronDown, LogOut, User as UserIcon, Shield } from 'lucide-react';
import { useSession } from '@/state/session';
import { useFlags } from '@/state/flags';
import { BrandMark } from '@/components/ui/BrandMark';
import { QuickTabs } from '@/components/shell/QuickTabs';
import { CommandPalette } from '@/components/shell/CommandPalette';
import { readCsrfToken } from '@/lib/globals';
import { cn } from '@/lib/cn';

function logout() {
    // Mirror V1: POST /auth/logout with CSRF, then bounce to the v2 login.
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/auth/logout';
    const csrf = document.createElement('input');
    csrf.type = 'hidden';
    csrf.name = '_token';
    csrf.value = readCsrfToken();
    form.appendChild(csrf);
    document.body.appendChild(form);
    form.submit();
}

export function TopNav({ onToggleSidebar }: { onToggleSidebar?: () => void }) {
    const user = useSession(s => s.user);
    const site = useFlags(s => s.site);
    const location = useLocation();
    const inAdmin = location.pathname.startsWith('/admin');
    const isAdmin = !!user?.root_admin || !!user?.admin_role_id;

    return (
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[var(--color-border)] bg-[var(--canvas)]/80 px-4 backdrop-blur">
            <div className="flex items-center gap-3">
                {onToggleSidebar && (
                    <button
                        onClick={onToggleSidebar}
                        className="flex h-10 w-10 items-center justify-center rounded-lg text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] lg:hidden"
                        aria-label={m['nav.topnav.toggleNav']()}
                    >
                        <Menu className="h-5 w-5" />
                    </button>
                )}
                <Link to="/">
                    <BrandMark name={site?.name ?? 'M12Labs'} />
                </Link>
            </div>

            <div className="flex items-center gap-2">
                {isAdmin && site?.quick_tabs && <QuickTabs />}
                {isAdmin && site?.command_palette && <CommandPalette />}
                {isAdmin && (
                    <Link
                        to={inAdmin ? '/' : '/admin'}
                        className={cn(
                            'hidden items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium sm:inline-flex',
                            'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]',
                        )}
                    >
                        <Shield className="h-4 w-4" />
                        {inAdmin ? m['nav.topnav.exitAdmin']() : m['nav.topnav.admin']()}
                    </Link>
                )}

                <DropdownMenu.Root>
                    <DropdownMenu.Trigger className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--color-surface-2)]">
                        <img
                            src={user?.avatar_url}
                            alt=""
                            className="h-8 w-8 rounded-full bg-[var(--color-surface-2)] object-cover"
                        />
                        <span className="hidden font-medium sm:block">{user?.username ?? m['nav.topnav.accountFallback']()}</span>
                        <ChevronDown className="h-4 w-4 text-[var(--color-ink-faint)]" />
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                        <DropdownMenu.Content
                            align="end"
                            sideOffset={8}
                            className="z-50 min-w-48 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-1.5 shadow-xl"
                        >
                            <DropdownMenu.Item asChild>
                                <Link
                                    to="/"
                                    className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-[var(--color-ink-muted)] outline-none hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                                >
                                    <UserIcon className="h-4 w-4" /> {m['nav.topnav.account']()}
                                </Link>
                            </DropdownMenu.Item>
                            <DropdownMenu.Separator className="my-1 h-px bg-[var(--color-border)]" />
                            <DropdownMenu.Item
                                onSelect={logout}
                                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm text-[var(--color-danger)] outline-none hover:bg-[var(--color-danger)]/10"
                            >
                                <LogOut className="h-4 w-4" /> {m['nav.topnav.signOut']()}
                            </DropdownMenu.Item>
                        </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                </DropdownMenu.Root>
            </div>
        </header>
    );
}

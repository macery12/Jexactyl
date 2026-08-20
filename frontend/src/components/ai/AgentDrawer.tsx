import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Bot, Maximize2, X } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import { useServer } from '@/components/server/ServerContext';
import { useFlags } from '@/state/flags';
import { useAgentChat } from '@/state/agentChat';
import { AgentChat } from './AgentChat';

// The assistant as a companion rather than a destination.
//
// The moment you want to ask "why did this crash" is while you are staring at
// the console, and "fix this config" while you are in the file manager — not
// after navigating away from either. The drawer keeps the same conversation the
// full page uses, so a question started here can be expanded without losing it.

const HOTKEY = 'k';

export function AgentDrawer() {
    const server = useServer();
    const everest = useFlags(s => s.everest);
    const location = useLocation();

    const open = useAgentChat(s => s.drawerOpen);
    const setDrawer = useAgentChat(s => s.setDrawer);
    const bind = useAgentChat(s => s.bind);
    const resumeActive = useAgentChat(s => s.resumeActive);
    const running = useAgentChat(s => s.loading);

    const enabled = Boolean(everest?.ai.enabled && everest.ai.feature_agent);

    // Rebinding clears state when the server changes; a conversation is bound
    // to one server for the life of a turn.
    //
    // Rejoining follows immediately, and this is the mount that matters: the
    // drawer is present on every server page, so a turn started here is picked
    // back up wherever the user went next — including after a reload, which
    // used to lose it entirely and look like nothing had happened.
    useEffect(() => {
        bind(server.uuid);
        resumeActive();
    }, [bind, resumeActive, server.uuid]);

    useEffect(() => {
        if (!enabled) return;

        const onKey = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === HOTKEY) {
                event.preventDefault();
                useAgentChat.getState().toggleDrawer();
            }
            if (event.key === 'Escape') setDrawer(false);
        };

        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [enabled, setDrawer]);

    // The full page is the same conversation; showing the drawer on top of it
    // would be two views of one thing fighting for the same scroll position.
    const onAiPage = location.pathname.endsWith('/ai');

    if (!enabled || onAiPage) return null;

    return (
        <>
            {!open && (
                <button
                    type="button"
                    onClick={() => setDrawer(true)}
                    title={running ? m['server.ai.drawer.running']() : m['server.ai.drawer.open']()}
                    className="fixed bottom-5 right-5 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--brand)] text-[var(--color-brand-ink)] shadow-lg shadow-black/20 transition-transform hover:scale-105"
                >
                    <Bot className="h-5 w-5" />

                    {/* The whole point of a durable turn, from the outside: a
                        turn carries on while you work elsewhere, and the only
                        way to know without opening the drawer is for the button
                        to say so. */}
                    {running && (
                        <span
                            aria-hidden
                            className="absolute -right-0.5 -top-0.5 flex h-3.5 w-3.5 items-center justify-center"
                        >
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--color-success)] opacity-75" />
                            <span className="relative inline-flex h-2.5 w-2.5 rounded-full border-2 border-[var(--brand)] bg-[var(--color-success)]" />
                        </span>
                    )}
                </button>
            )}

            <aside
                aria-hidden={!open}
                className={cn(
                    'fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-2xl shadow-black/30 transition-transform duration-200',
                    open ? 'translate-x-0' : 'pointer-events-none translate-x-full',
                )}
            >
                <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--color-border)] px-3">
                    <Bot className="h-4 w-4 text-[var(--brand)]" />
                    <span className="flex-1 truncate text-sm font-medium text-[var(--color-ink)]">
                        {m['server.ai.title']()}
                    </span>

                    <Link
                        to={`/server/${server.id}/ai`}
                        onClick={() => setDrawer(false)}
                        title={m['server.ai.drawer.expand']()}
                        className="rounded-md p-1.5 text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                    >
                        <Maximize2 className="h-4 w-4" />
                    </Link>
                    <button
                        type="button"
                        onClick={() => setDrawer(false)}
                        title={m['common.actions.close']()}
                        className="rounded-md p-1.5 text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </header>

                {/* Mounted only while open so a closed drawer is not polling or
                    holding a scroll container the page cannot see. */}
                {open && <AgentChat compact />}
            </aside>
        </>
    );
}

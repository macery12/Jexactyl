import { useEffect, useRef } from 'react';
import { Server, Cpu, MemoryStick, LayoutDashboard, Boxes } from 'lucide-react';
import { applyThemeVars, type Theme } from '@/lib/theme';

// A sandboxed mini-panel that renders the draft theme by writing its CSS vars
// onto this container only (not the whole app). Lets the operator see exactly
// what every control changes before committing.
export function ThemePreview({ theme }: { theme: Theme }) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (ref.current) applyThemeVars(theme, ref.current);
    }, [theme]);

    return (
        <div
            ref={ref}
            className="relative isolate overflow-hidden rounded-md border border-[var(--color-border-strong)] bg-[var(--color-canvas)] text-[var(--color-ink)]"
            style={{ borderRadius: 'var(--radius-card)' }}
        >
            <div className="bg-aurora pointer-events-none absolute inset-0 -z-10" />
            <div className="bg-grid pointer-events-none absolute inset-0 -z-10" />

            <div className="flex h-[360px]">
                {/* Sidebar */}
                <aside className="flex w-40 shrink-0 flex-col gap-1 border-r border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                    <div className="mb-2 flex items-center gap-2">
                        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[var(--brand)] text-[var(--color-brand-ink)]">
                            <Boxes className="h-3.5 w-3.5" />
                        </span>
                        <span className="text-sm font-semibold tracking-tight">Panel</span>
                    </div>
                    <NavItem icon={LayoutDashboard} label="Overview" active />
                    <NavItem icon={Server} label="Nodes" />
                    <NavItem icon={Boxes} label="Servers" />
                </aside>

                {/* Content */}
                <div className="flex min-w-0 flex-1 flex-col gap-3 p-4">
                    <div>
                        <h3 className="text-base font-semibold tracking-tight">Servers</h3>
                        <p className="text-xs text-[var(--color-ink-muted)]">Every server on the panel, woven by node.</p>
                    </div>

                    {/* A panel card */}
                    <div
                        className="flex flex-col gap-3 border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-3"
                        style={{ borderRadius: 'var(--radius-card)' }}
                    >
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">
                                Live status
                            </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-3">
                            <Dot color="var(--color-accent)" label="Active" />
                            <Dot color="var(--color-warning)" label="Installing" />
                            <Dot color="var(--color-danger)" label="Suspended" />
                        </div>
                        <div className="flex items-center gap-4 font-mono text-xs tabular-nums text-[var(--color-ink-muted)]">
                            <span className="flex items-center gap-1.5">
                                <Cpu className="h-3.5 w-3.5 text-[var(--color-ink-faint)]" /> 38%
                            </span>
                            <span className="flex items-center gap-1.5">
                                <MemoryStick className="h-3.5 w-3.5 text-[var(--color-ink-faint)]" /> 2.1 GiB
                            </span>
                        </div>
                    </div>

                    {/* Buttons */}
                    <div className="flex flex-wrap items-center gap-2">
                        <button
                            className="inline-flex h-8 items-center gap-1.5 px-3 text-xs font-medium text-[var(--color-brand-ink)]"
                            style={{ background: 'var(--brand)', borderRadius: 'var(--radius-card)' }}
                        >
                            Primary
                        </button>
                        <button
                            className="inline-flex h-8 items-center gap-1.5 bg-[var(--color-surface-2)] px-3 text-xs font-medium text-[var(--color-ink)]"
                            style={{ borderRadius: 'var(--radius-card)' }}
                        >
                            Secondary
                        </button>
                        <button
                            className="inline-flex h-8 items-center gap-1.5 border border-[var(--color-border-strong)] px-3 text-xs font-medium text-[var(--color-ink)]"
                            style={{ borderRadius: 'var(--radius-card)' }}
                        >
                            Outline
                        </button>
                    </div>

                    {/* Text ramp + link */}
                    <p className="text-xs leading-relaxed">
                        <span className="text-[var(--color-ink)]">Primary text</span>,{' '}
                        <span className="text-[var(--color-ink-muted)]">muted text</span>,{' '}
                        <span className="text-[var(--color-ink-faint)]">faint text</span> and a{' '}
                        <span className="font-medium text-[var(--brand)]">brand link</span>.
                    </p>
                </div>
            </div>
        </div>
    );
}

function NavItem({ icon: Icon, label, active }: { icon: typeof Server; label: string; active?: boolean }) {
    return (
        <div
            className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs"
            style={
                active
                    ? { background: 'var(--brand-soft)', color: 'var(--brand)' }
                    : { color: 'var(--color-ink-muted)' }
            }
        >
            <Icon className="h-3.5 w-3.5" />
            {label}
        </div>
    );
}

function Dot({ color, label }: { color: string; label: string }) {
    return (
        <span className="flex items-center gap-1.5 text-xs text-[var(--color-ink-muted)]">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
            {label}
        </span>
    );
}

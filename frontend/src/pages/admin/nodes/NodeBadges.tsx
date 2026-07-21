import { m } from '@/i18n';
import { Zap } from 'lucide-react';
import type { WingsType } from '@/api/nodes';
import { cn } from '@/lib/cn';

// Small ops-grade pill. Tone maps to the status color system used app-wide.
export function Badge({
    children,
    tone = 'muted',
    className,
}: {
    children: React.ReactNode;
    tone?: 'muted' | 'accent' | 'warning' | 'danger';
    className?: string;
}) {
    const tones = {
        muted: 'border-[var(--color-border-strong)] bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]',
        accent: 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]',
        warning: 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 text-[var(--color-warning)]',
        danger: 'border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 text-[var(--color-danger)]',
    } as const;
    return (
        <span
            className={cn(
                'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider',
                tones[tone],
                className,
            )}
        >
            {children}
        </span>
    );
}

// The "Supercharged" marker — the single visual signal that a node runs Wings-RS.
export function SuperchargedBadge({ wingsType }: { wingsType: WingsType }) {
    if (wingsType !== 'wings-rs') return null;
    return (
        <Badge tone="accent">
            <Zap className="h-2.5 w-2.5" /> {m['admin.nodes.supercharged']()}
        </Badge>
    );
}

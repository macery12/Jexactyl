import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { m } from '@/i18n/messages';
import { cn } from '@/lib/cn';

export interface IgnoredSetting {
    label: string;
    /** Why it does nothing here — named concretely, e.g. "Ollama only". */
    reason: string;
}

/**
 * The settings on this card that the configured provider does not honour.
 *
 * Hidden by default, because a form that renders every knob for every provider
 * is how three dead controls went unnoticed for months. Not *deleted*, though:
 * the values are still stored, and someone who set a temperature a year ago and
 * can no longer find it deserves to be told it is being ignored rather than
 * left to conclude the panel is broken.
 *
 * Renders nothing when the list is empty, so a card can pass its ignored set
 * unconditionally.
 */
export function IgnoredSettings({ items }: { items: IgnoredSetting[] }) {
    const [open, setOpen] = useState(false);

    if (items.length === 0) return null;

    return (
        <div className="rounded-lg border border-dashed border-[var(--color-border)] bg-[var(--color-surface-2)]/30">
            <button
                type="button"
                onClick={() => setOpen(previous => !previous)}
                aria-expanded={open}
                className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-xs text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink-muted)]"
            >
                <ChevronDown className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-180')} />
                <span>{m['admin.ai.settings.ignoredTitle']()}</span>
                <span className="ml-auto rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 font-mono text-[10px] tabular-nums">
                    {items.length}
                </span>
            </button>

            {open && (
                <ul className="space-y-1.5 border-t border-[var(--color-border)] px-3.5 py-3">
                    {items.map(item => (
                        <li key={item.label} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                            <span className="text-[var(--color-ink-muted)]">{item.label}</span>
                            <span className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--color-ink-faint)]">
                                {item.reason}
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

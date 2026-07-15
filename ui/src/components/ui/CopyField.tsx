import { useState } from 'react';
import { Copy, Check, Eye, EyeOff } from 'lucide-react';
import { cn } from '@/lib/cn';
import { m } from '@/i18n';

// Read-only labelled value that copies to the clipboard on click — the V2 stand-in
// for V1's CopyOnClick-wrapped Input. `secret` masks the value behind a reveal
// toggle (database passwords); copying still works while masked.
export function CopyField({
    label,
    value,
    secret = false,
    className,
}: {
    label: string;
    value: string;
    secret?: boolean;
    className?: string;
}) {
    const [copied, setCopied] = useState(false);
    const [revealed, setRevealed] = useState(false);

    const copy = () =>
        navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });

    const masked = secret && !revealed;

    return (
        <div className={className}>
            <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
                {label}
            </span>
            <div className="mt-1.5 flex items-center gap-1.5">
                <button
                    type="button"
                    onClick={copy}
                    title={m['common.actions.copy']()}
                    className="group flex min-w-0 flex-1 items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--color-surface-2)]"
                >
                    <span
                        className={cn(
                            'min-w-0 flex-1 truncate font-mono text-sm text-[var(--color-ink)]',
                            masked && 'select-none',
                        )}
                    >
                        {masked ? '•'.repeat(Math.min(value.length, 24)) : value}
                    </span>
                    {copied ? (
                        <Check className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" />
                    ) : (
                        <Copy className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-faint)] opacity-0 transition-opacity group-hover:opacity-100" />
                    )}
                </button>
                {secret && (
                    <button
                        type="button"
                        onClick={() => setRevealed(r => !r)}
                        title={revealed ? m['common.actions.hide']() : m['common.actions.reveal']()}
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--color-border)] text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                    >
                        {revealed ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                    </button>
                )}
            </div>
        </div>
    );
}

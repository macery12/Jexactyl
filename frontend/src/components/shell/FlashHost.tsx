import { CheckCircle2, XCircle, Info, AlertTriangle, X } from 'lucide-react';
import { useFlashes } from '@/state/flashes';
import { cn } from '@/lib/cn';

const icons = {
    success: CheckCircle2,
    error: XCircle,
    info: Info,
    warning: AlertTriangle,
} as const;

const tones = {
    success: 'border-[var(--color-accent)]/40 text-[var(--color-accent)]',
    error: 'border-[var(--color-danger)]/40 text-[var(--color-danger)]',
    info: 'border-[var(--brand)]/40 text-[var(--brand)]',
    warning: 'border-[var(--color-warning)]/40 text-[var(--color-warning)]',
} as const;

// Renders server-side flash messages bootstrapped from window.FlashMessages.
export function FlashHost() {
    const flashes = useFlashes(s => s.flashes);
    const dismiss = useFlashes(s => s.dismiss);

    if (flashes.length === 0) return null;

    return (
        <div className="fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
            {flashes.map(flash => {
                const Icon = icons[flash.type];
                return (
                    <div
                        key={flash.id}
                        className={cn(
                            'flex items-start gap-3 rounded-xl border bg-[var(--color-surface)] px-4 py-3 text-sm shadow-xl',
                            tones[flash.type],
                        )}
                    >
                        <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                        <span className="flex-1 text-[var(--color-ink)]">{flash.message}</span>
                        <button onClick={() => dismiss(flash.id)} className="text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]">
                            <X className="h-4 w-4" />
                        </button>
                    </div>
                );
            })}
        </div>
    );
}

import { useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { m } from '@/i18n';
import { Button } from '@/components/ui/Button';
import type { PendingAction } from '@/api/ai';
import { toolLabel } from './toolMeta';

// An approval the user walked away from.
//
// A suspended turn closes its stream and waits in the database for half an
// hour. Without something pointing back at it, the user sees an assistant that
// simply stopped mid-task and never learns why — so the moment they return to
// the server, this says what is waiting and how long it has left.
export function PendingBanner({ action, onReview }: { action: PendingAction; onReview: () => void }) {
    // A ticking clock rather than stored minutes: the countdown is derived from
    // the expiry, so the only state is "time has passed".
    const [, tick] = useState(0);

    useEffect(() => {
        const timer = setInterval(() => tick(n => n + 1), 30_000);
        return () => clearInterval(timer);
    }, []);

    const remaining = minutesLeft(action.expires_at);

    return (
        <div className="flex items-center gap-3 rounded-md border border-[var(--color-warning)]/50 bg-[var(--color-warning)]/10 px-3 py-2">
            <BellRing className="h-4 w-4 shrink-0 text-[var(--color-warning)]" />
            <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-[var(--color-ink)]">{m['server.ai.pending.title']()}</p>
                <p className="truncate text-xs text-[var(--color-ink-muted)]">
                    {m['server.ai.pending.body']({ tool: toolLabel(action.tool) })}
                    {remaining !== null && ` · ${m['server.ai.pending.expires']({ minutes: remaining })}`}
                </p>
            </div>
            <Button size="sm" variant="outline" onClick={onReview}>
                {m['server.ai.pending.review']()}
            </Button>
        </div>
    );
}

function minutesLeft(expiresAt: string | null): number | null {
    if (!expiresAt) return null;

    const diff = new Date(expiresAt).getTime() - Date.now();
    return diff <= 0 ? 0 : Math.ceil(diff / 60_000);
}

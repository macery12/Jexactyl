import { td } from '@/i18n';

// Where a logged request came from.
//
// There are five producers in the codebase — `client` and `agent` from a
// customer's server, `admin` and `admin-agent` from the panel, `modpack` from
// the marketplace — and until this existed the UI knew two of them by name and
// rendered everything else as "client". A panel running nothing but admin
// assistant turns reported itself as almost entirely customer traffic.
export const AI_SOURCES = ['client', 'agent', 'admin', 'admin-agent', 'modpack'] as const;

/** Which side of the panel the traffic came from, for colouring. */
export function sourceTone(source: string): 'panel' | 'customer' | 'other' {
    if (source === 'admin' || source === 'admin-agent') return 'panel';
    if (source === 'client' || source === 'agent') return 'customer';

    return 'other';
}

export const sourceChip: Record<ReturnType<typeof sourceTone>, string> = {
    panel: 'bg-[var(--brand)]/12 text-[var(--brand)]',
    customer: 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]',
    other: 'bg-[var(--color-surface-2)] text-[var(--color-ink-faint)]',
};

/**
 * A label for a source, falling back to the raw value.
 *
 * An unknown source is shown as itself rather than mislabelled as a known one —
 * `ModsController` writes whatever `$type` it was given, so the set is open.
 */
export function sourceLabel(source: string): string {
    return td(`admin.ai.sources.${source}`, source);
}

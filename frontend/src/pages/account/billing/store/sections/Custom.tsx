import type { StoreSectionData } from '@/lib/globals';

// Custom content block. Rendered strictly as plain text (whitespace preserved) —
// never as raw HTML — so admin-entered content can never inject markup/scripts.
export default function Custom({ data }: { data: StoreSectionData }) {
    const title = data.title?.trim();
    const body = data.body?.trim();
    if (!title && !body) return null;

    return (
        <section className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]/60 p-6 sm:p-8">
            <div className="mx-auto max-w-2xl text-center">
                {title && <h2 className="mb-3 text-2xl font-bold tracking-tight text-[var(--color-ink)]">{title}</h2>}
                {body && <p className="whitespace-pre-line text-pretty text-sm text-[var(--color-ink-muted)]">{body}</p>}
            </div>
        </section>
    );
}

import { m } from '@/i18n/messages';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileCode, Pencil, Search } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { FullPageSpinner } from '@/components/ui/Spinner';
import { getEmailTemplates, type EmailTemplateSummary } from '@/api/email';
import { TonePill } from '../parts';
import { TemplateEditorDialog } from './TemplateEditorDialog';

export const TEMPLATES_KEY = ['admin', 'email', 'templates'] as const;

// Content library for the transactional emails. Templates are grouped by
// category; clicking one opens the fullscreen editor with a live preview.
export default function TemplatesPage() {
    const [editing, setEditing] = useState<EmailTemplateSummary | null>(null);
    const [q, setQ] = useState('');

    const query = useQuery({ queryKey: TEMPLATES_KEY, queryFn: getEmailTemplates });

    // The editing target is kept fresh from the query so its `is_customized`
    // badge reflects the latest save/revert without re-opening.
    const current = useMemo(
        () => (editing ? query.data?.templates.find(t => t.key === editing.key) ?? editing : null),
        [editing, query.data],
    );

    const grouped = useMemo(() => {
        const list = query.data?.templates ?? [];
        const term = q.trim().toLowerCase();
        const filtered = term
            ? list.filter(
                  t =>
                      t.label.toLowerCase().includes(term) ||
                      t.key.toLowerCase().includes(term) ||
                      t.category.toLowerCase().includes(term),
              )
            : list;
        const map = new Map<string, EmailTemplateSummary[]>();
        for (const t of filtered) {
            const arr = map.get(t.category) ?? [];
            arr.push(t);
            map.set(t.category, arr);
        }
        return [...map.entries()];
    }, [query.data, q]);

    if (query.isLoading || !query.data) return <FullPageSpinner />;

    const total = query.data.templates.length;
    const customized = query.data.templates.filter(t => t.is_customized).length;

    return (
        <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h2 className="text-lg font-semibold text-[var(--color-ink)]">
                        {m['admin.email.templates.title']()}
                    </h2>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                        {m['admin.email.templates.desc']()}
                    </p>
                </div>
                <div className="flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
                    <span>{m['admin.email.templates.countTotal']({ count: total })}</span>
                    {customized > 0 && (
                        <TonePill tone="success">
                            {m['admin.email.templates.countCustomized']({ count: customized })}
                        </TonePill>
                    )}
                </div>
            </div>

            <div className="relative max-w-sm">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
                <Input
                    value={q}
                    onChange={e => setQ(e.target.value)}
                    placeholder={m['admin.email.templates.searchPlaceholder']()}
                    className="pl-9"
                />
            </div>

            {grouped.length === 0 ? (
                <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-strong)] px-6 py-16 text-center">
                    <p className="text-sm text-[var(--color-ink-muted)]">
                        {m['admin.email.templates.empty']()}
                    </p>
                </div>
            ) : (
                grouped.map(([category, items]) => (
                    <section key={category} className="flex flex-col gap-2">
                        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-[var(--color-ink-faint)]">
                            {category}
                        </h3>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                            {items.map(t => (
                                <TemplateCard key={t.key} template={t} onEdit={() => setEditing(t)} />
                            ))}
                        </div>
                    </section>
                ))
            )}

            {current && <TemplateEditorDialog template={current} onClose={() => setEditing(null)} />}
        </div>
    );
}

function TemplateCard({
    template,
    onEdit,
}: {
    template: EmailTemplateSummary;
    onEdit: () => void;
}) {
    return (
        <button
            onClick={onEdit}
            className="group flex flex-col gap-3 rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70 p-4 text-left transition-colors hover:border-[var(--brand)]/50 hover:bg-[var(--color-surface-2)]"
        >
            <div className="flex items-start justify-between gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-surface-2)] text-[var(--color-ink-muted)] group-hover:text-[var(--brand)]">
                    <FileCode className="h-5 w-5" />
                </div>
                {template.is_customized ? (
                    <TonePill tone="success">{m['admin.email.templates.customized']()}</TonePill>
                ) : (
                    <TonePill tone="neutral">{m['admin.email.templates.default']()}</TonePill>
                )}
            </div>
            <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[var(--color-ink)]">{template.label}</p>
                <code className="mt-0.5 block truncate text-[11px] text-[var(--color-ink-faint)]">
                    {template.key}
                </code>
            </div>
            <div className="mt-auto flex items-center justify-between pt-1">
                <span className="text-[11px] text-[var(--color-ink-muted)]">
                    {m['admin.email.templates.variableCount']({ count: template.variables.length })}
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-ink-muted)] group-hover:text-[var(--brand)]">
                    <Pencil className="h-3.5 w-3.5" />
                    {m['admin.email.templates.edit']()}
                </span>
            </div>
        </button>
    );
}

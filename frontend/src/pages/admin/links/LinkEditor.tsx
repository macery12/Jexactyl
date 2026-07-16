import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, ExternalLink } from 'lucide-react';
import { m } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { Switch } from '@/components/ui/Switch';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import {
    createLink,
    updateLink,
    deleteLink,
    type CustomLink,
    type CustomLinkPayload,
} from '@/api/adminLinks';

interface FormState {
    name: string;
    url: string;
    visible: boolean;
}

function initialFrom(link: CustomLink | null): FormState {
    return {
        name: link?.name ?? '',
        url: link?.url ?? '',
        // New links start hidden so a half-configured link never reaches users.
        visible: link?.visible ?? false,
    };
}

// Mirrors the backend's `url` validation rule closely enough to catch mistakes
// before the round-trip; the server stays the authority.
function isValidUrl(value: string): boolean {
    try {
        const parsed = new URL(value);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
        return false;
    }
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <section
            className="border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
            style={{ borderRadius: 'var(--radius-card)' }}
        >
            <h3 className="mb-4 text-sm font-semibold text-[var(--color-ink)]">{title}</h3>
            {children}
        </section>
    );
}

// Right-hand editor pane for the master–detail layout. `link === null` is create
// mode. The parent remounts this via a `key` so form state resets on selection
// change.
export default function LinkEditor({
    link,
    onSaved,
    onDeleted,
    onCancel,
}: {
    link: CustomLink | null;
    onSaved: (id: number) => void;
    onDeleted: () => void;
    onCancel: () => void;
}) {
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();
    const isNew = link === null;

    const initial = useMemo(() => initialFrom(link), [link]);
    const [form, setForm] = useState<FormState>(initial);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
        setForm(f => ({ ...f, [key]: value }));

    const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);

    // Only surface the URL error once there's something to be wrong about.
    const urlError = form.url.length > 0 && !isValidUrl(form.url);

    const buildPayload = (): CustomLinkPayload => ({
        name: form.name.trim(),
        url: form.url.trim(),
        visible: form.visible,
    });

    const saveMutation = useMutation({
        mutationFn: async (): Promise<number> => {
            if (isNew) return (await createLink(buildPayload())).id;
            await updateLink(link.id, buildPayload());
            return link.id;
        },
        onSuccess: id => {
            qc.invalidateQueries({ queryKey: ['admin', 'links'] });
            // The user sidebar reads the client endpoint — refresh it too so a
            // visibility change shows up without a reload.
            qc.invalidateQueries({ queryKey: ['links', 'visible'] });
            push({
                type: 'success',
                message: isNew ? m['admin.links.flash.created']() : m['admin.links.flash.updated'](),
            });
            onSaved(id);
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const deleteMutation = useMutation({
        mutationFn: () => deleteLink(link!.id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'links'] });
            qc.invalidateQueries({ queryKey: ['links', 'visible'] });
            push({ type: 'success', message: m['admin.links.flash.deleted']() });
            setConfirmDelete(false);
            onDeleted();
        },
        onError: err => {
            push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() });
            setConfirmDelete(false);
        },
    });

    const canSave =
        form.name.trim().length >= 3 &&
        isValidUrl(form.url.trim()) &&
        (isNew || dirty) &&
        !saveMutation.isPending;

    return (
        <div className="flex flex-col gap-6 pb-24">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold text-[var(--color-ink)]">
                        {isNew ? m['admin.links.editor.newTitle']() : m['admin.links.editor.editTitle']({ name: link.name })}
                    </h2>
                    {isNew ? (
                        <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">
                            {m['admin.links.editor.subtitle']()}
                        </p>
                    ) : (
                        <a
                            href={link.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="mt-0.5 inline-flex items-center gap-1.5 text-sm text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
                            title={m['admin.links.openLink']()}
                        >
                            <code className="truncate font-mono">{link.url}</code>
                            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                        </a>
                    )}
                </div>
                {!isNew && (
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                        <Trash2 className="h-4 w-4" />
                        {m['common.actions.delete']()}
                    </Button>
                )}
            </div>

            <div className="flex flex-col gap-6">
                <Card title={m['admin.links.editor.destination']()}>
                    <div className="flex flex-col gap-4">
                        <Field
                            label={m['admin.links.field.name']()}
                            hint={m['admin.links.field.nameHint']()}
                            htmlFor="link-name"
                        >
                            <Input
                                id="link-name"
                                value={form.name}
                                onChange={e => set('name', e.target.value)}
                                maxLength={191}
                            />
                        </Field>
                        <Field
                            label={m['admin.links.field.url']()}
                            hint={m['admin.links.field.urlHint']()}
                            error={urlError ? m['admin.links.field.urlInvalid']() : undefined}
                            htmlFor="link-url"
                        >
                            <Input
                                id="link-url"
                                type="url"
                                inputMode="url"
                                value={form.url}
                                invalid={urlError}
                                onChange={e => set('url', e.target.value)}
                                placeholder="https://example.com"
                            />
                        </Field>
                    </div>
                </Card>

                <Card title={m['admin.links.editor.visibility']()}>
                    <label className="flex cursor-pointer items-start gap-3">
                        <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium text-[var(--color-ink)]">
                                {m['admin.links.field.visible']()}
                            </span>
                            <span className="mt-0.5 block text-xs text-[var(--color-ink-faint)]">
                                {m['admin.links.field.visibleHint']()}
                            </span>
                        </span>
                        <Switch
                            checked={form.visible}
                            onChange={v => set('visible', v)}
                            label={m['admin.links.field.visible']()}
                            className="mt-0.5"
                        />
                    </label>
                </Card>
            </div>

            {/* Sticky save bar */}
            <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--color-border-strong)] bg-[var(--color-surface)]/95 backdrop-blur">
                <div className="mx-auto flex max-w-6xl items-center justify-end gap-3 px-4 py-3">
                    <span className="mr-auto text-xs text-[var(--color-ink-faint)]">
                        {isNew
                            ? m['admin.links.editor.newHint']()
                            : dirty
                              ? m['admin.links.editor.unsaved']()
                              : m['admin.links.editor.upToDate']()}
                    </span>
                    <Button variant="ghost" size="sm" onClick={onCancel} disabled={saveMutation.isPending}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button size="sm" onClick={() => saveMutation.mutate()} disabled={!canSave}>
                        {saveMutation.isPending && <Spinner className="h-4 w-4" />}
                        {isNew ? m['admin.links.editor.create']() : m['common.actions.saveChanges']()}
                    </Button>
                </div>
            </div>

            {!isNew && (
                <ConfirmDialog
                    open={confirmDelete}
                    onClose={() => setConfirmDelete(false)}
                    title={m['admin.links.delete.title']()}
                    body={m['admin.links.delete.body']({ name: link.name })}
                    confirmLabel={m['common.actions.delete']()}
                    cancelLabel={m['common.actions.cancel']()}
                    busy={deleteMutation.isPending}
                    onConfirm={() => deleteMutation.mutate()}
                />
            )}
        </div>
    );
}

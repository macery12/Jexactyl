import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, Check, Copy } from 'lucide-react';
import { m } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import {
    createDatabaseHost,
    updateDatabaseHost,
    deleteDatabaseHost,
    hostAddress,
    type DatabaseHost,
    type DatabaseHostPayload,
} from '@/api/adminDatabases';

interface FormState {
    name: string;
    host: string;
    port: number;
    username: string;
    password: string;
}

function initialFrom(host: DatabaseHost | null): FormState {
    return {
        name: host?.name ?? '',
        host: host?.host ?? '',
        port: host?.port ?? 3306,
        username: host?.username ?? '',
        password: '',
    };
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

// Right-hand editor pane for the master–detail layout. `host === null` is create
// mode. The parent remounts this via a `key` so form state resets on selection
// change.
export default function DatabaseEditor({
    host,
    onSaved,
    onDeleted,
    onCancel,
}: {
    host: DatabaseHost | null;
    onSaved: (saved: DatabaseHost) => void;
    onDeleted: () => void;
    onCancel: () => void;
}) {
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();
    const isNew = host === null;

    const initial = useMemo(() => initialFrom(host), [host]);
    const [form, setForm] = useState<FormState>(initial);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [copied, setCopied] = useState(false);

    const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
        setForm(f => ({ ...f, [key]: value }));

    const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(initial), [form, initial]);

    const buildPayload = (): DatabaseHostPayload => ({
        name: form.name.trim(),
        host: form.host.trim(),
        port: Number.isFinite(form.port) ? form.port : 3306,
        username: form.username.trim(),
        // Only send the password when the operator typed one — blank keeps the
        // stored credential on update, and lets the host start credential-less.
        password: form.password.length > 0 ? form.password : undefined,
    });

    const saveMutation = useMutation({
        mutationFn: () =>
            isNew ? createDatabaseHost(buildPayload()) : updateDatabaseHost(host.id, buildPayload()),
        onSuccess: saved => {
            qc.invalidateQueries({ queryKey: ['admin', 'databases'] });
            push({
                type: 'success',
                message: isNew
                    ? m['admin.databases.flash.created']()
                    : m['admin.databases.flash.updated'](),
            });
            onSaved(saved);
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const deleteMutation = useMutation({
        mutationFn: () => deleteDatabaseHost(host!.id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'databases'] });
            push({ type: 'success', message: m['admin.databases.flash.deleted']() });
            setConfirmDelete(false);
            onDeleted();
        },
        onError: err => {
            push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() });
            setConfirmDelete(false);
        },
    });

    const copyAddress = () => {
        if (!host) return;
        navigator.clipboard?.writeText(hostAddress(host)).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    };

    const canSave =
        form.name.trim().length > 0 &&
        form.host.trim().length > 0 &&
        form.username.trim().length > 0 &&
        form.port >= 1 &&
        form.port <= 65535 &&
        (isNew || dirty) &&
        !saveMutation.isPending;

    return (
        <div className="flex flex-col gap-6 pb-24">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold text-[var(--color-ink)]">
                        {isNew
                            ? m['admin.databases.editor.newTitle']()
                            : m['admin.databases.editor.editTitle']({ name: host.name })}
                    </h2>
                    {isNew ? (
                        <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">
                            {m['admin.databases.editor.subtitle']()}
                        </p>
                    ) : (
                        <button
                            type="button"
                            onClick={copyAddress}
                            className="mt-0.5 inline-flex items-center gap-1.5 text-sm text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
                            title={m['admin.databases.copyAddress']()}
                        >
                            <code className="font-mono">{hostAddress(host)}</code>
                            {copied ? (
                                <Check className="h-3.5 w-3.5 text-[var(--color-accent)]" />
                            ) : (
                                <Copy className="h-3.5 w-3.5" />
                            )}
                        </button>
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
                <Card title={m['admin.databases.editor.connection']()}>
                    <div className="flex flex-col gap-4">
                        <Field
                            label={m['admin.databases.field.name']()}
                            hint={m['admin.databases.field.nameHint']()}
                            htmlFor="db-name"
                        >
                            <Input id="db-name" value={form.name} onChange={e => set('name', e.target.value)} maxLength={191} />
                        </Field>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr,8rem]">
                            <Field
                                label={m['admin.databases.field.host']()}
                                hint={m['admin.databases.field.hostHint']()}
                                htmlFor="db-host"
                            >
                                <Input id="db-host" value={form.host} onChange={e => set('host', e.target.value)} placeholder="127.0.0.1" />
                            </Field>
                            <Field label={m['admin.databases.field.port']()} htmlFor="db-port">
                                <Input
                                    id="db-port"
                                    type="number"
                                    min={1}
                                    max={65535}
                                    value={form.port}
                                    onChange={e => set('port', e.target.valueAsNumber || 0)}
                                />
                            </Field>
                        </div>
                    </div>
                </Card>

                <Card title={m['admin.databases.editor.credentials']()}>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <Field
                            label={m['admin.databases.field.username']()}
                            hint={m['admin.databases.field.usernameHint']()}
                            htmlFor="db-username"
                        >
                            <Input id="db-username" value={form.username} onChange={e => set('username', e.target.value)} maxLength={32} autoComplete="off" />
                        </Field>
                        <Field
                            label={m['admin.databases.field.password']()}
                            hint={isNew ? m['admin.databases.field.passwordHintNew']() : m['admin.databases.field.passwordHint']()}
                            htmlFor="db-password"
                        >
                            <Input
                                id="db-password"
                                type="password"
                                value={form.password}
                                onChange={e => set('password', e.target.value)}
                                placeholder="••••••••"
                                autoComplete="new-password"
                            />
                        </Field>
                    </div>
                </Card>
            </div>

            {/* Sticky save bar */}
            <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--color-border-strong)] bg-[var(--color-surface)]/95 backdrop-blur">
                <div className="mx-auto flex max-w-6xl items-center justify-end gap-3 px-4 py-3">
                    <span className="mr-auto text-xs text-[var(--color-ink-faint)]">
                        {isNew
                            ? m['admin.databases.editor.newHint']()
                            : dirty
                              ? m['admin.databases.editor.unsaved']()
                              : m['admin.databases.editor.upToDate']()}
                    </span>
                    <Button variant="ghost" size="sm" onClick={onCancel} disabled={saveMutation.isPending}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button size="sm" onClick={() => saveMutation.mutate()} disabled={!canSave}>
                        {saveMutation.isPending && <Spinner className="h-4 w-4" />}
                        {isNew ? m['admin.databases.editor.create']() : m['common.actions.saveChanges']()}
                    </Button>
                </div>
            </div>

            {!isNew && (
                <ConfirmDialog
                    open={confirmDelete}
                    onClose={() => setConfirmDelete(false)}
                    title={m['admin.databases.delete.title']()}
                    body={m['admin.databases.delete.body']({ name: host.name })}
                    confirmLabel={m['common.actions.delete']()}
                    cancelLabel={m['common.actions.cancel']()}
                    busy={deleteMutation.isPending}
                    onConfirm={() => deleteMutation.mutate()}
                />
            )}
        </div>
    );
}

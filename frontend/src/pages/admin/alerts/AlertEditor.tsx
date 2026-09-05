import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, X, Trash2 } from 'lucide-react';
import { m } from '@/i18n/messages';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import {
    createAlert,
    updateAlert,
    deleteAlert,
    searchAlertUsers,
    type Alert,
    type AlertType,
    type AlertPosition,
    type AlertScope,
    type UserTargeting,
    type AlertUser,
    type AlertPayload,
} from '@/api/adminAlerts';
import AlertPreview from './AlertPreview';

interface FormState {
    title: string;
    content: string;
    type: AlertType;
    position: AlertPosition;
    scope: AlertScope;
    userTargeting: UserTargeting;
    enabled: boolean;
    dismissible: boolean;
    link: string;
    linkText: string;
    priority: number;
    startAt: string;
    endAt: string;
}

function toDateInput(value: string | null): string {
    return value ? (value.split('T')[0] ?? '') : '';
}

function initialFrom(alert: Alert | null): FormState {
    return {
        title: alert?.title ?? '',
        content: alert?.content ?? '',
        type: alert?.type ?? 'info',
        position: alert?.position ?? 'notification',
        scope: alert?.scope ?? 'global',
        userTargeting: alert?.user_targeting ?? 'all',
        enabled: alert?.enabled ?? true,
        dismissible: alert?.dismissible ?? false,
        link: alert?.link ?? '',
        linkText: alert?.link_text ?? '',
        priority: alert?.priority ?? 0,
        startAt: toDateInput(alert?.start_at ?? null),
        endAt: toDateInput(alert?.end_at ?? null),
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

const TYPE_OPTIONS: { value: AlertType; label: string }[] = [
    { value: 'success', label: m['admin.alerts.type.success']() },
    { value: 'info', label: m['admin.alerts.type.info']() },
    { value: 'warning', label: m['admin.alerts.type.warning']() },
    { value: 'danger', label: m['admin.alerts.type.danger']() },
];

const POSITION_OPTIONS: { value: AlertPosition; label: string }[] = [
    { value: 'notification', label: m['admin.alerts.position.notification']() },
    { value: 'top-center', label: m['admin.alerts.position.top-center']() },
    { value: 'slide-out', label: m['admin.alerts.position.slide-out']() },
    { value: 'center', label: m['admin.alerts.position.center']() },
];

const SCOPE_OPTIONS: { value: AlertScope; label: string }[] = [
    { value: 'global', label: m['admin.alerts.scope.global']() },
    { value: 'dashboard', label: m['admin.alerts.scope.dashboard']() },
    { value: 'server', label: m['admin.alerts.scope.server']() },
    { value: 'billing', label: m['admin.alerts.scope.billing']() },
    { value: 'account', label: m['admin.alerts.scope.account']() },
    { value: 'admin', label: m['admin.alerts.scope.admin']() },
];

const TARGETING_OPTIONS: { value: UserTargeting; label: string }[] = [
    { value: 'all', label: m['admin.alerts.targeting.all']() },
    { value: 'specific', label: m['admin.alerts.targeting.specific']() },
];

// Debounced user picker for `specific` targeting. Mirrors V1's SearchableSelect
// behaviour: type ≥2 chars, pick a result to add a chip, remove to drop.
function UserPicker({
    selected,
    onChange,
}: {
    selected: AlertUser[];
    onChange: (next: AlertUser[]) => void;
}) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<AlertUser[]>([]);
    const [searching, setSearching] = useState(false);

    useEffect(() => {
        if (query.trim().length < 2) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: syncs state to prop/query/filter changes
            setResults([]);
            return;
        }
        let cancelled = false;
        setSearching(true);
        const t = setTimeout(() => {
            searchAlertUsers(query.trim())
                .then(users => {
                    if (cancelled) return;
                    setResults(users.filter(u => !selected.some(s => s.id === u.id)));
                })
                .catch(() => !cancelled && setResults([]))
                .finally(() => !cancelled && setSearching(false));
        }, 300);
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, [query, selected]);

    const add = (user: AlertUser) => {
        onChange([...selected, user]);
        setQuery('');
        setResults([]);
    };

    return (
        <div className="flex flex-col gap-3">
            <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
                <Input
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder={m['admin.alerts.targeting.searchPlaceholder']()}
                    className="pl-9"
                />
                {(results.length > 0 || searching) && (
                    <div className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-1 shadow-xl shadow-black/30">
                        {searching && results.length === 0 ? (
                            <div className="flex items-center gap-2 px-3 py-2 text-sm text-[var(--color-ink-muted)]">
                                <Spinner className="h-4 w-4" />
                                {m['common.states.loading']()}
                            </div>
                        ) : (
                            results.map(u => (
                                <button
                                    key={u.id}
                                    type="button"
                                    onClick={() => add(u)}
                                    className="flex w-full flex-col rounded-lg px-3 py-2 text-left text-sm text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
                                >
                                    <span>{u.email}</span>
                                    <span className="text-xs text-[var(--color-ink-faint)]">@{u.username}</span>
                                </button>
                            ))
                        )}
                    </div>
                )}
            </div>

            {selected.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {selected.map(u => (
                        <span
                            key={u.id}
                            className="inline-flex items-center gap-2 rounded-lg bg-[var(--color-surface-2)] px-3 py-1.5 text-sm text-[var(--color-ink)]"
                        >
                            {u.email}
                            <button
                                type="button"
                                onClick={() => onChange(selected.filter(s => s.id !== u.id))}
                                className="text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-danger)]"
                                aria-label={m['common.actions.remove']()}
                            >
                                <X className="h-4 w-4" />
                            </button>
                        </span>
                    ))}
                </div>
            )}
            <p className="text-xs text-[var(--color-ink-faint)]">
                {m['admin.alerts.targeting.count']({ count: selected.length })}
            </p>
        </div>
    );
}

// Right-hand editor pane for the master–detail layout. `alert === null` is
// create mode. The parent remounts this via a `key` so form state resets on
// selection change.
export default function AlertEditor({
    alert,
    onSaved,
    onDeleted,
    onCancel,
}: {
    alert: Alert | null;
    onSaved: (saved: Alert) => void;
    onDeleted: () => void;
    onCancel: () => void;
}) {
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();
    const isNew = alert === null;

    const initial = useMemo(() => initialFrom(alert), [alert]);
    const [form, setForm] = useState<FormState>(initial);
    const [users, setUsers] = useState<AlertUser[]>(alert?.users ?? []);
    const initialUsers = useRef(alert?.users ?? []);
    const [confirmDelete, setConfirmDelete] = useState(false);

    const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
        setForm(f => ({ ...f, [key]: value }));

    const dirty = useMemo(() => {
        const formChanged = JSON.stringify(form) !== JSON.stringify(initial);
        const usersChanged =
            JSON.stringify(users.map(u => u.id).sort()) !==
            // initialUsers.current is an immutable snapshot taken once on mount.
            // eslint-disable-next-line react-hooks/refs -- stable mount snapshot, safe to read in render
            JSON.stringify(initialUsers.current.map(u => u.id).sort());
        return formChanged || usersChanged;
    }, [form, initial, users]);

    const buildPayload = (): AlertPayload => ({
        title: form.title.trim() || undefined,
        content: form.content,
        type: form.type,
        position: form.position,
        scope: form.scope,
        user_targeting: form.userTargeting,
        user_ids: form.userTargeting === 'specific' ? users.map(u => u.id) : undefined,
        enabled: form.enabled,
        dismissible: form.dismissible,
        link: form.link.trim() || undefined,
        link_text: form.linkText.trim() || undefined,
        priority: Number.isFinite(form.priority) ? form.priority : 0,
        start_at: form.startAt || undefined,
        end_at: form.endAt || undefined,
    });

    const saveMutation = useMutation({
        mutationFn: () =>
            isNew ? createAlert(buildPayload()) : updateAlert(alert.id, buildPayload()),
        onSuccess: saved => {
            qc.invalidateQueries({ queryKey: ['admin', 'alerts'] });
            push({
                type: 'success',
                message: isNew ? m['admin.alerts.flash.created']() : m['admin.alerts.flash.updated'](),
            });
            onSaved(saved);
        },
        onError: err => push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() }),
    });

    const deleteMutation = useMutation({
        mutationFn: () => deleteAlert(alert!.id),
        onSuccess: () => {
            qc.invalidateQueries({ queryKey: ['admin', 'alerts'] });
            push({ type: 'success', message: m['admin.alerts.flash.deleted']() });
            setConfirmDelete(false);
            onDeleted();
        },
        onError: err => {
            push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() });
            setConfirmDelete(false);
        },
    });

    const canSave = form.content.trim().length > 0 && dirty && !saveMutation.isPending;

    return (
        <div className="flex flex-col gap-6 pb-24">
            <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold text-[var(--color-ink)]">
                        {isNew
                            ? m['admin.alerts.editor.newTitle']()
                            : m['admin.alerts.editor.editTitle']({ title: alert.title || `#${alert.id}` })}
                    </h2>
                    <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">
                        {m['admin.alerts.editor.subtitle']()}
                    </p>
                </div>
                {!isNew && (
                    <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
                        <Trash2 className="h-4 w-4" />
                        {m['common.actions.delete']()}
                    </Button>
                )}
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr,20rem]">
                <div className="flex min-w-0 flex-col gap-6">
                    <Card title={m['admin.alerts.editor.basic']()}>
                        <div className="flex flex-col gap-4">
                            <Field label={m['admin.alerts.field.title']()} hint={m['admin.alerts.field.titleHint']()} htmlFor="alert-title">
                                <Input id="alert-title" value={form.title} onChange={e => set('title', e.target.value)} />
                            </Field>
                            <Field label={m['admin.alerts.field.content']()} hint={m['admin.alerts.field.contentHint']()} htmlFor="alert-content">
                                <Textarea id="alert-content" value={form.content} onChange={e => set('content', e.target.value)} maxLength={1000} />
                            </Field>
                        </div>
                    </Card>

                    <Card title={m['admin.alerts.editor.appearance']()}>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <Field label={m['admin.alerts.field.type']()} htmlFor="alert-type">
                                <Select id="alert-type" value={form.type} onChange={v => set('type', v as AlertType)} options={TYPE_OPTIONS} />
                            </Field>
                            <Field label={m['admin.alerts.field.position']()} htmlFor="alert-position">
                                <Select id="alert-position" value={form.position} onChange={v => set('position', v as AlertPosition)} options={POSITION_OPTIONS} />
                            </Field>
                            {form.position !== 'notification' && (
                                <Field label={m['admin.alerts.field.scope']()} hint={m['admin.alerts.field.scopeHint']()} htmlFor="alert-scope">
                                    <Select id="alert-scope" value={form.scope} onChange={v => set('scope', v as AlertScope)} options={SCOPE_OPTIONS} />
                                </Field>
                            )}
                            <Field label={m['admin.alerts.field.priority']()} hint={m['admin.alerts.field.priorityHint']()} htmlFor="alert-priority">
                                <Input
                                    id="alert-priority"
                                    type="number"
                                    min={0}
                                    value={form.priority}
                                    onChange={e => set('priority', e.target.valueAsNumber || 0)}
                                />
                            </Field>
                        </div>
                    </Card>

                    <Card title={m['admin.alerts.editor.behaviour']()}>
                        <div className="flex flex-col gap-4">
                            <label className="flex items-center justify-between gap-4">
                                <span className="text-sm text-[var(--color-ink)]">{m['admin.alerts.field.enabled']()}</span>
                                <Switch checked={form.enabled} onChange={v => set('enabled', v)} />
                            </label>
                            <label className="flex items-center justify-between gap-4">
                                <div>
                                    <span className="text-sm text-[var(--color-ink)]">{m['admin.alerts.field.dismissible']()}</span>
                                    <p className="text-xs text-[var(--color-ink-faint)]">{m['admin.alerts.field.dismissibleHint']()}</p>
                                </div>
                                <Switch checked={form.dismissible} onChange={v => set('dismissible', v)} />
                            </label>
                        </div>
                    </Card>

                    <Card title={m['admin.alerts.editor.link']()}>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <Field label={m['admin.alerts.field.link']()} htmlFor="alert-link">
                                <Input id="alert-link" type="url" value={form.link} onChange={e => set('link', e.target.value)} placeholder="https://" />
                            </Field>
                            <Field label={m['admin.alerts.field.linkText']()} hint={m['admin.alerts.field.linkTextHint']()} htmlFor="alert-link-text">
                                <Input id="alert-link-text" value={form.linkText} onChange={e => set('linkText', e.target.value)} />
                            </Field>
                        </div>
                    </Card>

                    <Card title={m['admin.alerts.editor.targeting']()}>
                        <div className="flex flex-col gap-4">
                            <Field label={m['admin.alerts.field.targeting']()} hint={m['admin.alerts.field.targetingHint']()} htmlFor="alert-targeting">
                                <Select
                                    id="alert-targeting"
                                    value={form.userTargeting}
                                    onChange={v => set('userTargeting', v as UserTargeting)}
                                    options={TARGETING_OPTIONS}
                                />
                            </Field>
                            {form.userTargeting === 'specific' && <UserPicker selected={users} onChange={setUsers} />}
                        </div>
                    </Card>

                    <Card title={m['admin.alerts.editor.schedule']()}>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <Field label={m['admin.alerts.field.startAt']()} hint={m['admin.alerts.field.startAtHint']()} htmlFor="alert-start">
                                <Input id="alert-start" type="date" value={form.startAt} onChange={e => set('startAt', e.target.value)} />
                            </Field>
                            <Field label={m['admin.alerts.field.endAt']()} hint={m['admin.alerts.field.endAtHint']()} htmlFor="alert-end">
                                <Input id="alert-end" type="date" value={form.endAt} onChange={e => set('endAt', e.target.value)} />
                            </Field>
                        </div>
                    </Card>
                </div>

                <div className="xl:sticky xl:top-4 xl:h-fit">
                    <AlertPreview
                        type={form.type}
                        position={form.position}
                        title={form.title}
                        content={form.content}
                        dismissible={form.dismissible}
                        link={form.link}
                        linkText={form.linkText}
                    />
                </div>
            </div>

            {/* Sticky save bar */}
            <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[var(--color-border-strong)] bg-[var(--color-surface)]/95 backdrop-blur">
                <div className="mx-auto flex max-w-6xl items-center justify-end gap-3 px-4 py-3">
                    <span className="mr-auto text-xs text-[var(--color-ink-faint)]">
                        {dirty ? m['admin.alerts.editor.unsaved']() : m['admin.alerts.editor.upToDate']()}
                    </span>
                    <Button variant="ghost" size="sm" onClick={onCancel} disabled={saveMutation.isPending}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button size="sm" onClick={() => saveMutation.mutate()} disabled={!canSave}>
                        {saveMutation.isPending && <Spinner className="h-4 w-4" />}
                        {isNew ? m['admin.alerts.editor.create']() : m['common.actions.saveChanges']()}
                    </Button>
                </div>
            </div>

            {!isNew && (
                <ConfirmDialog
                    open={confirmDelete}
                    onClose={() => setConfirmDelete(false)}
                    title={m['admin.alerts.delete.title']()}
                    body={m['admin.alerts.delete.body']()}
                    confirmLabel={m['common.actions.delete']()}
                    cancelLabel={m['common.actions.cancel']()}
                    busy={deleteMutation.isPending}
                    onConfirm={() => deleteMutation.mutate()}
                />
            )}
        </div>
    );
}

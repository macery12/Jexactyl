import { useEffect, useState } from 'react';
import { GripVertical, Pencil, Plus, Trash2, X } from 'lucide-react';
import { m, td } from '@/i18n';
import { cn } from '@/lib/cn';
import { firstError } from '@/lib/apiError';
import { useFlashes } from '@/state/flashes';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Spinner } from '@/components/ui/Spinner';
import {
    createEggVariable,
    deleteEggVariable,
    updateEggVariables,
    type AdminEggVariable,
    type EggFieldType,
    type NewEggVariable,
} from '@/api/adminNests';

const RULE_SUGGESTIONS = ['required', 'nullable', 'string', 'numeric', 'boolean', 'ip', 'alpha_num'];

const FIELD_TYPES: EggFieldType[] = ['text', 'password', 'number', 'boolean'];

const EMPTY_DRAFT: NewEggVariable = {
    name: '',
    description: '',
    environmentVariable: '',
    defaultValue: '',
    isUserViewable: false,
    isUserEditable: false,
    fieldType: 'text',
    rules: '',
};

function parseRules(input: string): string[] {
    return (input || '')
        .split('|')
        .map(r => r.trim())
        .filter(r => r.length > 0);
}

function typeBadgeClass(type: EggFieldType): string {
    switch (type) {
        case 'password':
            return 'bg-[var(--color-danger)]/10 text-[var(--color-danger)] border-[var(--color-danger)]/40';
        case 'number':
            return 'bg-[var(--brand)]/10 text-[var(--brand)] border-[var(--brand)]/40';
        case 'boolean':
            return 'bg-[var(--color-warning)]/10 text-[var(--color-warning)] border-[var(--color-warning)]/40';
        default:
            return 'bg-[var(--color-accent)]/10 text-[var(--color-accent)] border-[var(--color-accent)]/40';
    }
}

// ─── Rules chip builder ───────────────────────────────────────────────────────

function RulesBuilder({ value, onChange }: { value: string; onChange: (next: string) => void }) {
    const current = parseRules(value);
    const [draft, setDraft] = useState('');

    const setRules = (next: string[]) => onChange(next.join('|'));

    const add = () => {
        const next = draft.trim();
        if (!next || current.includes(next)) return;
        setRules([...current, next]);
        setDraft('');
    };

    return (
        <div className="flex flex-col gap-2">
            <label className="text-sm font-medium text-[var(--color-ink-muted)]">
                {m['admin.nests.egg.variables.rules']()}
            </label>

            {current.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {current.map(rule => (
                        <button
                            type="button"
                            key={rule}
                            onClick={() => setRules(current.filter(r => r !== rule))}
                            className="inline-flex items-center gap-1 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-2 py-1 text-xs text-[var(--color-ink)] hover:border-[var(--color-danger)]/50"
                        >
                            {rule} <X className="h-3 w-3" />
                        </button>
                    ))}
                </div>
            )}

            <div className="flex gap-2">
                <Input
                    className="h-9"
                    value={draft}
                    placeholder={m['admin.nests.egg.variables.rulePlaceholder']()}
                    onChange={e => setDraft(e.currentTarget.value)}
                    onKeyDown={e => {
                        if (e.key === 'Enter') {
                            e.preventDefault();
                            add();
                        }
                    }}
                />
                <Button type="button" variant="outline" size="sm" onClick={add}>
                    {m['admin.nests.egg.variables.addRule']()}
                </Button>
            </div>

            <div className="flex flex-wrap gap-2">
                {RULE_SUGGESTIONS.map(rule => (
                    <button
                        key={rule}
                        type="button"
                        onClick={() => !current.includes(rule) && setRules([...current, rule])}
                        className={cn(
                            'rounded-lg border px-2 py-1 text-xs transition-colors',
                            current.includes(rule)
                                ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
                                : 'border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
                        )}
                    >
                        {rule}
                    </button>
                ))}
            </div>
        </div>
    );
}

// ─── Shared variable form ─────────────────────────────────────────────────────

function VariableFields({
    draft,
    patch,
}: {
    draft: NewEggVariable;
    patch: (p: Partial<NewEggVariable>) => void;
}) {
    return (
        <div className="flex flex-col gap-4">
            <Field label={m['admin.nests.egg.variables.name']()} htmlFor="var-name">
                <Input id="var-name" value={draft.name} onChange={e => patch({ name: e.currentTarget.value })} />
            </Field>

            <Field label={m['common.labels.description']()} htmlFor="var-desc">
                <Textarea
                    id="var-desc"
                    rows={2}
                    value={draft.description}
                    onChange={e => patch({ description: e.currentTarget.value })}
                />
            </Field>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label={m['admin.nests.egg.variables.envVariable']()} htmlFor="var-env">
                    <Input
                        id="var-env"
                        className="font-mono"
                        value={draft.environmentVariable}
                        onChange={e => patch({ environmentVariable: e.currentTarget.value })}
                    />
                </Field>
                <Field label={m['admin.nests.egg.variables.defaultValue']()} htmlFor="var-default">
                    <Input
                        id="var-default"
                        value={draft.defaultValue}
                        onChange={e => patch({ defaultValue: e.currentTarget.value })}
                    />
                </Field>
            </div>

            <Field label={m['admin.nests.egg.variables.fieldType']()} htmlFor="var-type">
                <Select
                    id="var-type"
                    value={draft.fieldType}
                    onChange={v => patch({ fieldType: v as EggFieldType })}
                    options={FIELD_TYPES.map(t => ({ value: t, label: td(`admin.nests.egg.variables.type.${t}`, t) }))}
                />
            </Field>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-4 py-3">
                    <span className="text-sm text-[var(--color-ink)]">{m['admin.nests.egg.variables.userViewable']()}</span>
                    <Switch
                        checked={draft.isUserViewable}
                        onChange={v => patch({ isUserViewable: v })}
                        label={m['admin.nests.egg.variables.userViewable']()}
                    />
                </label>
                <label className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 px-4 py-3">
                    <span className="text-sm text-[var(--color-ink)]">{m['admin.nests.egg.variables.userEditable']()}</span>
                    <Switch
                        checked={draft.isUserEditable}
                        onChange={v => patch({ isUserEditable: v })}
                        label={m['admin.nests.egg.variables.userEditable']()}
                    />
                </label>
            </div>

            <RulesBuilder value={draft.rules} onChange={rules => patch({ rules })} />
        </div>
    );
}

// ─── Edit modal ───────────────────────────────────────────────────────────────

function EditVariableModal({
    variable,
    onClose,
    onSave,
}: {
    variable: AdminEggVariable;
    onClose: () => void;
    onSave: (next: AdminEggVariable) => void;
}) {
    const [draft, setDraft] = useState<AdminEggVariable>(variable);

    return (
        <Modal
            open
            onClose={onClose}
            title={draft.environmentVariable || draft.name || m['admin.nests.egg.variables.editTitle']()}
            size="lg"
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={onClose}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button size="sm" onClick={() => onSave(draft)}>
                        {m['common.actions.apply']()}
                    </Button>
                </>
            }
        >
            <VariableFields draft={draft} patch={p => setDraft(prev => ({ ...prev, ...p }))} />
        </Modal>
    );
}

// ─── New variable modal ───────────────────────────────────────────────────────

function NewVariableModal({ eggId, onClose, onCreated }: { eggId: number; onClose: () => void; onCreated: () => void }) {
    const push = useFlashes(s => s.push);
    const [draft, setDraft] = useState<NewEggVariable>(EMPTY_DRAFT);
    const [saving, setSaving] = useState(false);

    const submit = async () => {
        setSaving(true);
        try {
            await createEggVariable(eggId, draft);
            push({ type: 'success', message: m['admin.nests.egg.variables.created']() });
            onCreated();
            onClose();
        } catch (err) {
            push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() });
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal
            open
            onClose={onClose}
            title={m['admin.nests.egg.variables.newTitle']()}
            size="lg"
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button size="sm" onClick={submit} disabled={saving}>
                        {saving && <Spinner className="h-4 w-4" />}
                        {m['common.actions.create']()}
                    </Button>
                </>
            }
        >
            <VariableFields draft={draft} patch={p => setDraft(prev => ({ ...prev, ...p }))} />
        </Modal>
    );
}

// ─── Row ──────────────────────────────────────────────────────────────────────

function VariableRow({
    variable,
    index,
    onEdit,
    onDelete,
    onDragStart,
    onDrop,
}: {
    variable: AdminEggVariable;
    index: number;
    onEdit: () => void;
    onDelete: () => void;
    onDragStart: (index: number) => void;
    onDrop: (index: number) => void;
}) {
    const rules = parseRules(variable.rules);
    const isRequired = rules.includes('required');
    const defaultValue = variable.defaultValue.trim() || m['admin.nests.egg.variables.noDefault']();

    return (
        <tr
            draggable
            onDragStart={() => onDragStart(index)}
            onDragOver={e => e.preventDefault()}
            onDrop={() => onDrop(index)}
            className="border-b border-[var(--color-border)] transition-colors last:border-b-0 hover:bg-[var(--color-surface-2)]/40"
        >
            <td className="w-8 px-3 py-3">
                <GripVertical className="h-4 w-4 cursor-move text-[var(--color-ink-faint)]" />
            </td>
            <td className="px-3 py-3">
                <div className="truncate font-mono text-xs font-semibold text-[var(--color-ink)]">
                    {variable.environmentVariable || variable.name}
                </div>
                {variable.name && variable.environmentVariable && (
                    <div className="mt-0.5 truncate text-xs text-[var(--color-ink-faint)]">{variable.name}</div>
                )}
            </td>
            <td className="w-24 px-3 py-3">
                <span className={cn('rounded border px-2 py-0.5 font-mono text-xs', typeBadgeClass(variable.fieldType))}>
                    {variable.fieldType}
                </span>
            </td>
            <td className="w-36 px-3 py-3">
                <span className="block max-w-[130px] truncate rounded bg-[var(--color-surface-2)] px-2 py-0.5 font-mono text-xs text-[var(--color-ink-muted)]">
                    {defaultValue}
                </span>
            </td>
            <td className="px-3 py-3">
                <div className="flex flex-wrap gap-1.5">
                    {isRequired && (
                        <span className="rounded border border-[var(--brand)]/40 bg-[var(--brand)]/10 px-2 py-0.5 text-xs text-[var(--brand)]">
                            {m['admin.nests.egg.variables.flag.required']()}
                        </span>
                    )}
                    {variable.isUserViewable && (
                        <span className="rounded border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-2 py-0.5 text-xs text-[var(--color-ink-muted)]">
                            {m['admin.nests.egg.variables.flag.viewable']()}
                        </span>
                    )}
                    {variable.isUserEditable && (
                        <span className="rounded border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-2 py-0.5 text-xs text-[var(--color-accent)]">
                            {m['admin.nests.egg.variables.flag.editable']()}
                        </span>
                    )}
                </div>
            </td>
            <td className="w-24 px-3 py-3">
                <div className="flex items-center justify-end gap-2">
                    <Button type="button" variant="outline" size="sm" className="h-8 px-2" onClick={onEdit}>
                        <Pencil className="h-3.5 w-3.5" /> {m['common.actions.edit']()}
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-[var(--color-ink-faint)] hover:text-[var(--color-danger)]"
                        aria-label={m['common.actions.delete']()}
                        onClick={onDelete}
                    >
                        <Trash2 className="h-4 w-4" />
                    </Button>
                </div>
            </td>
        </tr>
    );
}

// ─── Tab ──────────────────────────────────────────────────────────────────────

export function VariablesTab({
    eggId,
    variables,
    onChanged,
}: {
    eggId: number;
    variables: AdminEggVariable[];
    onChanged: () => void;
}) {
    const push = useFlashes(s => s.push);
    const [rows, setRows] = useState<AdminEggVariable[]>(variables);
    const [baseline, setBaseline] = useState<AdminEggVariable[]>(variables);
    const [dragging, setDragging] = useState<number | null>(null);
    const [editing, setEditing] = useState<AdminEggVariable | null>(null);
    const [showNew, setShowNew] = useState(false);
    const [pendingDelete, setPendingDelete] = useState<AdminEggVariable | null>(null);
    const [saving, setSaving] = useState(false);
    const [busy, setBusy] = useState(false);

    // Re-sync to server truth whenever the parent egg refetches (create / delete
    // / cross-tab save). In-tab edits don't change the `variables` prop.
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: syncs state to prop/query/filter changes
        setRows(variables);
        setBaseline(variables);
    }, [variables]);

    const dirty = JSON.stringify(rows) !== JSON.stringify(baseline);

    const save = async () => {
        setSaving(true);
        try {
            await updateEggVariables(eggId, rows);
            push({ type: 'success', message: m['admin.nests.egg.variables.saved']() });
            onChanged();
        } catch (err) {
            push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() });
        } finally {
            setSaving(false);
        }
    };

    const confirmDelete = async () => {
        if (!pendingDelete) return;
        setBusy(true);
        try {
            await deleteEggVariable(eggId, pendingDelete.id);
            setRows(prev => prev.filter(v => v.id !== pendingDelete.id));
            push({ type: 'success', message: m['admin.nests.egg.variables.deleted']() });
            onChanged();
        } catch (err) {
            push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() });
        } finally {
            setBusy(false);
            setPendingDelete(null);
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
                <Button type="button" variant="outline" size="sm" onClick={() => setShowNew(true)}>
                    <Plus className="h-4 w-4" /> {m['admin.nests.egg.variables.new']()}
                </Button>
                <span className="text-xs text-[var(--color-ink-faint)]">
                    {m['admin.nests.egg.variables.count']({ count: rows.length })}
                </span>
                <Button type="button" size="sm" className="ml-auto" onClick={save} disabled={!dirty || saving}>
                    {saving && <Spinner className="h-4 w-4" />}
                    {m['common.actions.saveChanges']()}
                </Button>
            </div>

            {rows.length === 0 ? (
                <div className="rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface-2)]/30 px-6 py-12 text-center text-sm text-[var(--color-ink-faint)]">
                    {m['admin.nests.egg.variables.empty']()}
                </div>
            ) : (
                <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-border)]">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-[var(--color-border)] bg-[var(--color-surface-2)]/50 text-left text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
                                <th className="w-8 px-3 py-2" />
                                <th className="px-3 py-2">{m['admin.nests.egg.variables.colVariable']()}</th>
                                <th className="w-24 px-3 py-2">{m['admin.nests.egg.variables.colType']()}</th>
                                <th className="w-36 px-3 py-2">{m['admin.nests.egg.variables.colDefault']()}</th>
                                <th className="px-3 py-2">{m['admin.nests.egg.variables.colFlags']()}</th>
                                <th className="w-24 px-3 py-2" />
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((v, i) => (
                                <VariableRow
                                    key={v.id || i}
                                    variable={v}
                                    index={i}
                                    onEdit={() => setEditing(v)}
                                    onDelete={() => setPendingDelete(v)}
                                    onDragStart={setDragging}
                                    onDrop={dropIndex => {
                                        if (dragging === null || dragging === dropIndex) return;
                                        const next = [...rows];
                                        const [moved] = next.splice(dragging, 1);
                                        if (moved) next.splice(dropIndex, 0, moved);
                                        setRows(next);
                                        setDragging(null);
                                    }}
                                />
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {editing && (
                <EditVariableModal
                    variable={editing}
                    onClose={() => setEditing(null)}
                    onSave={next => {
                        setRows(prev => prev.map(v => (v.id === next.id ? next : v)));
                        setEditing(null);
                    }}
                />
            )}

            {showNew && (
                <NewVariableModal eggId={eggId} onClose={() => setShowNew(false)} onCreated={onChanged} />
            )}

            <ConfirmDialog
                open={pendingDelete !== null}
                onClose={() => setPendingDelete(null)}
                title={m['admin.nests.egg.variables.deleteTitle']()}
                body={m['admin.nests.egg.variables.deleteBody']()}
                confirmLabel={m['admin.nests.egg.variables.deleteConfirm']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={busy}
                onConfirm={confirmDelete}
            />
        </div>
    );
}

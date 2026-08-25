import { m } from '@/i18n/messages';
import { useMemo, useState } from 'react';
import { useQueries } from '@tanstack/react-query';
import { Database, Plus, Minus, AlertTriangle } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import {
    getDatabasePlan,
    type DatabasePlan,
    type DatabasePlanOperation,
    type BatchDropDataItem,
} from '@/api/extensions';

const tint = (v: string, pct: number) => `color-mix(in srgb, ${v} ${pct}%, transparent)`;

// One extension the modal previews. For install/update the repository + version
// let the backend fetch and parse the archive's migrations; uninstall needs
// neither (it reads local state).
export interface DbModalExtension {
    id: string;
    name: string;
    repositoryId?: number | null;
    version?: string;
}

type DropState = Record<string, { drop: boolean; confirm: string }>;

/**
 * Pre-flight "this will modify your database" review shown before an install,
 * update, or uninstall (single or batch). It fetches a read-only plan per
 * extension — showing the tables that will be added, dropped, or preserved —
 * and, for uninstall, hosts the per-extension opt-in data drop with the same
 * typed-id confirmation the CLI requires. Confirming hands the parent the list
 * of extensions whose data should be dropped.
 */
export function DatabaseChangesModal({
    open,
    operation,
    extensions,
    busy,
    onClose,
    onConfirm,
}: {
    open: boolean;
    operation: DatabasePlanOperation;
    extensions: DbModalExtension[];
    busy: boolean;
    onClose: () => void;
    onConfirm: (drops: BatchDropDataItem[]) => void;
}) {
    // The modal is mounted only while open, so drop opt-ins start fresh each
    // time it appears — no reset effect needed.
    const [drops, setDrops] = useState<DropState>({});

    const plans = useQueries({
        queries: extensions.map(ext => ({
            queryKey: ['admin', 'extension-db-plan', operation, ext.id, ext.version ?? null],
            queryFn: () =>
                getDatabasePlan(ext.id, operation, {
                    repositoryId: ext.repositoryId ?? undefined,
                    version: ext.version,
                }),
            enabled: open,
            staleTime: 0,
            retry: false,
        })),
    });

    const loading = plans.some(q => q.isLoading);

    // A drop opt-in is only valid once its typed confirmation echoes the id.
    const dropItems = useMemo<BatchDropDataItem[]>(
        () =>
            extensions
                .filter(ext => drops[ext.id]?.drop && drops[ext.id]?.confirm.trim() === ext.id)
                .map(ext => ({ id: ext.id, confirm: ext.id })),
        [extensions, drops],
    );

    // Block confirm while any opted-in drop is still missing its typed id.
    const pendingConfirm = extensions.some(
        ext => drops[ext.id]?.drop && drops[ext.id]?.confirm.trim() !== ext.id,
    );

    const canConfirm = open && !busy && !loading && !pendingConfirm;
    const dropping = dropItems.length > 0;

    const setDrop = (id: string, patch: Partial<{ drop: boolean; confirm: string }>) =>
        setDrops(prev => ({ ...prev, [id]: { drop: false, confirm: '', ...prev[id], ...patch } }));

    const confirmLabel =
        operation === 'install'
            ? m['extensions.dbchanges.confirmInstall']()
            : operation === 'update'
              ? m['extensions.dbchanges.confirmUpdate']()
              : dropping
                ? m['extensions.dbchanges.confirmUninstallDrop']()
                : m['extensions.dbchanges.confirmUninstall']();

    return (
        <Modal
            open={open}
            onClose={onClose}
            size={extensions.length > 1 ? 'md' : 'sm'}
            title={m['extensions.dbchanges.title']()}
            description={m['extensions.dbchanges.intro']()}
            footer={
                <>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={busy}
                        className="inline-flex h-9 items-center rounded-lg border border-[var(--color-border-strong)] px-4 text-sm font-medium text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-50"
                    >
                        {m['common.actions.cancel']()}
                    </button>
                    <button
                        type="button"
                        disabled={!canConfirm}
                        onClick={() => onConfirm(dropItems)}
                        className="inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-medium text-[var(--color-brand-ink)] transition-colors disabled:opacity-50"
                        style={{ background: dropping ? 'var(--color-danger)' : 'var(--brand)' }}
                    >
                        {busy && <Spinner className="h-4 w-4" />}
                        {confirmLabel}
                    </button>
                </>
            }
        >
            <div className="space-y-4">
                {extensions.map((ext, i) => (
                    <ExtensionPlan
                        key={ext.id}
                        ext={ext}
                        operation={operation}
                        query={plans[i]!}
                        drop={drops[ext.id]?.drop ?? false}
                        confirm={drops[ext.id]?.confirm ?? ''}
                        onToggleDrop={next => setDrop(ext.id, { drop: next, confirm: next ? drops[ext.id]?.confirm ?? '' : '' })}
                        onConfirmChange={v => setDrop(ext.id, { confirm: v })}
                        showName={extensions.length > 1}
                        busy={busy}
                    />
                ))}
            </div>
        </Modal>
    );
}

function ExtensionPlan({
    ext,
    operation,
    query,
    drop,
    confirm,
    onToggleDrop,
    onConfirmChange,
    showName,
    busy,
}: {
    ext: DbModalExtension;
    operation: DatabasePlanOperation;
    query: { data?: DatabasePlan; isLoading: boolean; isError: boolean };
    drop: boolean;
    confirm: string;
    onToggleDrop: (next: boolean) => void;
    onConfirmChange: (v: string) => void;
    showName: boolean;
    busy: boolean;
}) {
    const plan = query.data;

    return (
        <section className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 p-3">
            {showName && (
                <h3 className="mb-2 flex items-center gap-1.5 text-sm font-medium text-[var(--color-ink)]">
                    <Database className="h-3.5 w-3.5 text-[var(--color-ink-faint)]" />
                    {ext.name}
                </h3>
            )}

            {query.isLoading ? (
                <p className="flex items-center gap-2 text-xs text-[var(--color-ink-muted)]">
                    <Spinner className="h-3.5 w-3.5" />
                    {m['extensions.dbchanges.fetching']()}
                </p>
            ) : query.isError || !plan ? (
                <p className="flex items-center gap-2 text-xs text-[var(--color-danger)]">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    {m['extensions.dbchanges.loadError']()}
                </p>
            ) : !plan.hasDatabase ? (
                <p className="text-xs text-[var(--color-ink-faint)]">{m['extensions.dbchanges.noChanges']()}</p>
            ) : operation === 'uninstall' ? (
                <UninstallPlan
                    ext={ext}
                    plan={plan}
                    drop={drop}
                    confirm={confirm}
                    onToggleDrop={onToggleDrop}
                    onConfirmChange={onConfirmChange}
                    busy={busy}
                />
            ) : (
                <AddPlan plan={plan} />
            )}
        </section>
    );
}

// install / update — tables that will be created plus (for update) the ones
// that stay in place.
function AddPlan({ plan }: { plan: DatabasePlan }) {
    const creates = plan.tablesToCreate ?? [];
    const unchanged = plan.unchangedTables ?? [];
    const migrationCount = (plan.migrations ?? []).length;

    return (
        <div className="space-y-2">
            {creates.length > 0 ? (
                <TableList label={m['extensions.dbchanges.willAdd']()} tables={creates} tone="add" />
            ) : (
                <p className="text-xs text-[var(--color-ink-faint)]">{m['extensions.dbchanges.noNewTables']()}</p>
            )}
            {unchanged.length > 0 && (
                <TableList label={m['extensions.dbchanges.unchanged']()} tables={unchanged} tone="muted" />
            )}
            {migrationCount > 0 && (
                <p className="text-[11px] text-[var(--color-ink-faint)]">
                    {m['extensions.dbchanges.migrations']({ count: migrationCount })}
                </p>
            )}
        </div>
    );
}

// uninstall — tables the extension owns, preserved by default, dropped only on
// an explicit typed confirmation.
function UninstallPlan({
    ext,
    plan,
    drop,
    confirm,
    onToggleDrop,
    onConfirmChange,
    busy,
}: {
    ext: DbModalExtension;
    plan: DatabasePlan;
    drop: boolean;
    confirm: string;
    onToggleDrop: (next: boolean) => void;
    onConfirmChange: (v: string) => void;
    busy: boolean;
}) {
    const tables = plan.existingTables ?? [];

    return (
        <div className="space-y-2.5">
            {tables.length > 0 && (
                <TableList
                    label={drop ? m['extensions.dbchanges.willDrop']() : m['extensions.dbchanges.willPreserve']()}
                    tables={tables}
                    tone={drop ? 'drop' : 'muted'}
                />
            )}

            <label className="flex cursor-pointer items-start gap-2 text-xs text-[var(--color-ink-muted)]">
                <input
                    type="checkbox"
                    checked={drop}
                    disabled={busy}
                    onChange={ev => onToggleDrop(ev.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 accent-[var(--color-danger)]"
                />
                <span>
                    {m['extensions.dbchanges.dropLabel']()}{' '}
                    <span className="text-[var(--color-danger)]">{m['extensions.dbchanges.dropWarning']()}</span>
                </span>
            </label>

            {drop ? (
                <Input
                    value={confirm}
                    disabled={busy}
                    placeholder={m['extensions.drawer.dropDataConfirm']({ id: ext.id })}
                    onChange={ev => onConfirmChange(ev.target.value)}
                />
            ) : (
                <p className="text-[11px] text-[var(--color-ink-faint)]">{m['extensions.dbchanges.preservedHint']()}</p>
            )}
        </div>
    );
}

function TableList({ label, tables, tone }: { label: string; tables: string[]; tone: 'add' | 'drop' | 'muted' }) {
    const color = tone === 'add' ? 'var(--color-accent)' : tone === 'drop' ? 'var(--color-danger)' : 'var(--color-ink-muted)';
    const Icon = tone === 'add' ? Plus : tone === 'drop' ? Minus : null;

    return (
        <div>
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--color-ink-faint)]">{label}</p>
            <ul className="space-y-1">
                {tables.map(table => (
                    <li
                        key={table}
                        className="flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[11px]"
                        style={{
                            color,
                            borderColor: tone === 'muted' ? 'var(--color-border)' : tint(color, 30),
                            background: tone === 'muted' ? 'transparent' : tint(color, 8),
                        }}
                    >
                        {Icon && <Icon className="h-3 w-3 shrink-0" />}
                        <span className="truncate">{table}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
}

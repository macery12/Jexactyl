import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Bell, CheckCircle2, Info, AlertTriangle, XCircle } from 'lucide-react';
import { m, td } from '@/i18n';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { getAlerts, type Alert, type AlertType } from '@/api/adminAlerts';
import AlertEditor from './AlertEditor';

type Selection = { mode: 'edit'; id: number } | { mode: 'new' } | null;

const TYPE_META: Record<AlertType, { token: string; Icon: typeof Info }> = {
    success: { token: 'var(--color-accent)', Icon: CheckCircle2 },
    info: { token: 'var(--brand)', Icon: Info },
    warning: { token: 'var(--color-warning)', Icon: AlertTriangle },
    danger: { token: 'var(--color-danger)', Icon: XCircle },
};

function TypeDot({ type }: { type: AlertType }) {
    const { token, Icon } = TYPE_META[type];
    return <Icon className="h-4 w-4 shrink-0" style={{ color: token }} />;
}

function RailRow({ alert, active, onClick }: { alert: Alert; active: boolean; onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'flex w-full flex-col gap-1 border-l-2 px-3 py-2.5 text-left transition-colors',
                active
                    ? 'border-[var(--brand)] bg-[var(--brand-soft)]'
                    : 'border-transparent hover:bg-[var(--color-surface-2)]',
            )}
        >
            <span className="flex items-center gap-2">
                <TypeDot type={alert.type} />
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--color-ink)]">
                    {alert.title || alert.content}
                </span>
                {!alert.enabled && (
                    <span className="shrink-0 rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">
                        {m['admin.alerts.rail.off']()}
                    </span>
                )}
            </span>
            <span className="flex items-center gap-1.5 pl-6 text-xs text-[var(--color-ink-faint)]">
                <span>{td(`admin.alerts.position.${alert.position}`)}</span>
                <span>·</span>
                <span>{m['admin.alerts.rail.priority']({ value: alert.priority })}</span>
            </span>
        </button>
    );
}

// Admin Alerts — master–detail workspace. Left rail lists every alert; the right
// pane edits the selected one (or creates a new one) with a live preview. Full
// V1 parity for `/admin/alerts` (list / create / edit / delete + user
// targeting), backed by the existing Application API. No backend changes.
export default function AlertsSection() {
    const { data: alerts, isLoading, isError } = useQuery({
        queryKey: ['admin', 'alerts'],
        queryFn: getAlerts,
    });

    const [selection, setSelection] = useState<Selection>(null);

    // Auto-select the first alert once loaded so the detail pane is never blank
    // when content exists; fall back to the create form on an empty list.
    useEffect(() => {
        if (!alerts || selection !== null) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: syncs state to prop/query/filter changes
        setSelection(alerts.length > 0 ? { mode: 'edit', id: alerts[0]!.id } : { mode: 'new' });
    }, [alerts, selection]);

    const selectedAlert = useMemo(() => {
        if (!selection || selection.mode !== 'edit' || !alerts) return null;
        return alerts.find(a => a.id === selection.id) ?? null;
    }, [selection, alerts]);

    // A stale edit-selection (e.g. after a delete elsewhere) collapses to new.
    useEffect(() => {
        if (selection?.mode === 'edit' && alerts && !alerts.some(a => a.id === selection.id)) {
            // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: syncs state to prop/query/filter changes
            setSelection(alerts.length > 0 ? { mode: 'edit', id: alerts[0]!.id } : { mode: 'new' });
        }
    }, [selection, alerts]);

    const editorKey = selection?.mode === 'edit' ? `edit-${selection.id}` : 'new';

    return (
        <div className="flex flex-col gap-6">
            <header className="flex items-start justify-between gap-4">
                <div>
                    <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
                        <Bell className="h-6 w-6 text-[var(--color-ink-muted)]" />
                        {m['admin.alerts.title']()}
                    </h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.alerts.subtitle']()}</p>
                </div>
                <Button size="sm" onClick={() => setSelection({ mode: 'new' })}>
                    <Plus className="h-4 w-4" />
                    {m['admin.alerts.newAlert']()}
                </Button>
            </header>

            <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
                {/* Rail */}
                <aside className="w-full shrink-0 lg:w-72">
                    <div
                        className="overflow-hidden border border-[var(--color-border)] bg-[var(--color-surface)]"
                        style={{ borderRadius: 'var(--radius-card)' }}
                    >
                        {isLoading ? (
                            <div className="flex items-center justify-center py-12">
                                <Spinner className="h-5 w-5" />
                            </div>
                        ) : isError ? (
                            <p className="px-4 py-8 text-center text-sm text-[var(--color-danger)]">
                                {m['common.states.genericError']()}
                            </p>
                        ) : !alerts || alerts.length === 0 ? (
                            <p className="px-4 py-8 text-center text-sm text-[var(--color-ink-faint)]">
                                {m['admin.alerts.empty']()}
                            </p>
                        ) : (
                            <div className="flex flex-col divide-y divide-[var(--color-border)]">
                                {alerts.map(alert => (
                                    <RailRow
                                        key={alert.id}
                                        alert={alert}
                                        active={selection?.mode === 'edit' && selection.id === alert.id}
                                        onClick={() => setSelection({ mode: 'edit', id: alert.id })}
                                    />
                                ))}
                            </div>
                        )}
                    </div>
                </aside>

                {/* Detail */}
                <div className="min-w-0 flex-1">
                    {selection === null ? (
                        <div className="flex items-center justify-center py-20 text-sm text-[var(--color-ink-faint)]">
                            <Spinner className="h-5 w-5" />
                        </div>
                    ) : (
                        <AlertEditor
                            key={editorKey}
                            alert={selectedAlert}
                            onSaved={saved => setSelection({ mode: 'edit', id: saved.id })}
                            onDeleted={() =>
                                setSelection(
                                    alerts && alerts.length > 1
                                        ? { mode: 'edit', id: alerts.find(a => a.id !== selectedAlert?.id)!.id }
                                        : { mode: 'new' },
                                )
                            }
                            onCancel={() =>
                                setSelection(
                                    alerts && alerts.length > 0 ? { mode: 'edit', id: alerts[0]!.id } : { mode: 'new' },
                                )
                            }
                        />
                    )}
                </div>
            </div>
        </div>
    );
}

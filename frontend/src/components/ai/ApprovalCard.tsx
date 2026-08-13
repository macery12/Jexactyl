import { useState } from 'react';
import { AlertTriangle, Check, ShieldAlert, X } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import type { ChatEntry } from '@/state/agentChat';
import { DiffView } from './DiffView';
import { ToolIcon, toolLabel, toolTarget } from './toolMeta';

type ApprovalEntry = Extract<ChatEntry, { kind: 'approval' }>;

// The turn has stopped and will not continue until the user decides.
//
// Two bars, matching the two tiers the backend enforces: a recoverable change
// is approved inline, while anything destructive opens a dialog that demands
// the server's name typed out — the same bar the panel applies to deleting one
// by hand, and the same string the backend re-checks.
export function ApprovalCard({
    entry,
    confirmPhrase,
    disabled,
    onDecide,
}: {
    entry: ApprovalEntry;
    confirmPhrase: string;
    disabled: boolean;
    onDecide: (decision: 'approve' | 'reject', confirmation?: string) => void;
}) {
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [typed, setTyped] = useState('');

    const destructive = entry.risk === 'destructive';
    const target = toolTarget(entry.tool, entry.args);

    if (entry.decision) {
        return (
            <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-ink-faint)]">
                {entry.decision === 'approved' ? (
                    <Check className="h-3.5 w-3.5 text-[var(--color-accent)]" />
                ) : (
                    <X className="h-3.5 w-3.5" />
                )}
                <span>
                    {entry.decision === 'approved'
                        ? m['server.ai.approval.approved']({ tool: toolLabel(entry.tool) })
                        : m['server.ai.approval.rejected']({ tool: toolLabel(entry.tool) })}
                </span>
            </div>
        );
    }

    const confirmMatches = typed.trim().toLowerCase() === confirmPhrase.toLowerCase();

    return (
        <>
            <div
                className={cn(
                    'overflow-hidden rounded-lg border',
                    destructive
                        ? 'border-[var(--color-danger)]/50 bg-[var(--color-danger)]/5'
                        : 'border-[var(--brand)]/40 bg-[var(--brand-soft)]/40',
                )}
            >
                <div className="flex items-center gap-2 px-3 py-2">
                    <ToolIcon
                        tool={entry.tool}
                        className={cn(
                            'h-4 w-4 shrink-0',
                            destructive ? 'text-[var(--color-danger)]' : 'text-[var(--brand)]',
                        )}
                    />
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[var(--color-ink)]">
                            {m['server.ai.approval.title']({ tool: toolLabel(entry.tool) })}
                        </p>
                        {target && (
                            <p className="truncate font-mono text-[11px] text-[var(--color-ink-muted)]">{target}</p>
                        )}
                    </div>
                    {destructive && (
                        <span className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--color-danger)]/15 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-danger)]">
                            <AlertTriangle className="h-3 w-3" />
                            {m['server.ai.approval.destructive']()}
                        </span>
                    )}
                </div>

                {entry.preview?.kind === 'diff' && (
                    <div className="px-3 pb-2">
                        <DiffView original={entry.preview.original} updated={entry.preview.updated} />
                    </div>
                )}

                {!entry.preview && Object.keys(entry.args).length > 0 && (
                    <div className="px-3 pb-2">
                        <pre className="max-h-40 overflow-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] p-2 font-mono text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
                            {JSON.stringify(entry.args, null, 2)}
                        </pre>
                    </div>
                )}

                <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-3 py-2">
                    <Button size="sm" variant="ghost" disabled={disabled} onClick={() => onDecide('reject')}>
                        {m['server.ai.approval.decline']()}
                    </Button>
                    <Button
                        size="sm"
                        variant={destructive ? 'danger' : 'primary'}
                        disabled={disabled}
                        onClick={() => (destructive ? setConfirmOpen(true) : onDecide('approve'))}
                    >
                        {destructive ? m['server.ai.approval.reviewAndRun']() : m['server.ai.approval.approve']()}
                    </Button>
                </div>
            </div>

            <Modal
                open={confirmOpen}
                onClose={() => {
                    setConfirmOpen(false);
                    setTyped('');
                }}
                title={m['server.ai.approval.confirmTitle']()}
                size="sm"
                footer={
                    <div className="flex justify-end gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                                setConfirmOpen(false);
                                setTyped('');
                            }}
                        >
                            {m['common.actions.cancel']()}
                        </Button>
                        <Button
                            variant="danger"
                            size="sm"
                            disabled={!confirmMatches || disabled}
                            onClick={() => {
                                setConfirmOpen(false);
                                onDecide('approve', typed.trim());
                                setTyped('');
                            }}
                        >
                            {m['server.ai.approval.runIt']()}
                        </Button>
                    </div>
                }
            >
                <div className="space-y-3">
                    <div className="flex gap-2 rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/5 p-3">
                        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-danger)]" />
                        <p className="text-sm text-[var(--color-ink)]">
                            {m['server.ai.approval.confirmBody']({
                                tool: toolLabel(entry.tool),
                                server: confirmPhrase,
                            })}
                        </p>
                    </div>

                    {target && (
                        <pre className="overflow-x-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-2 font-mono text-xs text-[var(--color-ink)]">
                            {target}
                        </pre>
                    )}

                    <Field label={m['server.ai.approval.confirmLabel']({ server: confirmPhrase })}>
                        <Input
                            value={typed}
                            onChange={e => setTyped(e.target.value)}
                            placeholder={confirmPhrase}
                            autoFocus
                        />
                    </Field>
                </div>
            </Modal>
        </>
    );
}

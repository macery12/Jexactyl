import { useState } from 'react';
import { AlertTriangle, Check, ShieldAlert, User, X } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import type { AiApprovalPreview } from '@/lib/aiStream';
import type { ChatEntry } from '@/state/agentChat';
import { BatchPreview } from './BatchPreview';
import { DiffView } from './DiffView';
import { ToolArgs } from './ToolArgs';
import { ToolIcon, toolLabel, toolTarget } from './toolMeta';

type ApprovalEntry = Extract<ChatEntry, { kind: 'approval' }>;

// The turn has stopped and will not continue until the user decides.
//
// Two bars, matching the two tiers the backend enforces: a recoverable change
// is approved inline, while anything destructive opens a dialog that demands
// the server's name typed out — the same bar the panel applies to deleting one
// by hand, and the same string the backend re-checks.
//
// Whatever tier it is, the card has one job: make the decision answerable
// without reading JSON. A preview handles the arguments that do not read as
// themselves — a file write as a diff, a customer's server as its name and owner
// rather than the id the model happened to quote — and `ToolArgs` lays out the
// rest. Anything the preview has already said is not then repeated underneath
// it, which is what keeps the reason the eye lands on.
export function ApprovalCard({
    entry,
    confirmPhrase,
    disabled,
    redactions = {},
    onDecide,
}: {
    entry: ApprovalEntry;
    confirmPhrase: string;
    disabled: boolean;
    redactions?: Record<string, string>;
    onDecide: (decision: 'approve' | 'reject', confirmation?: string) => void;
}) {
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [typed, setTyped] = useState('');

    const destructive = entry.risk === 'destructive';
    const spoken = spokenFor(entry.preview);
    const remaining = Object.fromEntries(
        Object.entries(entry.args).filter(([key]) => !spoken.has(key)),
    );

    // The subtitle under the tool name is the call's primary argument, which for
    // a file write is the path and is worth having — the diff below it shows the
    // change but not what is being changed. A server preview already names its
    // subject in full, so repeating the id it was quoted by adds only doubt.
    const target = entry.preview?.kind === 'server' ? null : toolTarget(entry.tool, entry.args);

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

    const submitting = entry.submission === 'submitting';

    const requiredConfirmation =
        entry.preview?.kind === 'confirmation' ? entry.preview.name : confirmPhrase;
    const confirmMatches = typed.trim() === requiredConfirmation;

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
                            {/* A batch is titled by how much it does, not by
                                what it is called. "Approve: Batch" describes the
                                mechanism; "Approve 20 changes" describes the
                                decision. */}
                            {entry.preview?.kind === 'batch'
                                ? m['server.ai.approval.batchTitle']({ count: entry.preview.count })
                                : m['server.ai.approval.title']({ tool: toolLabel(entry.tool) })}
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

                {target && <ExactApprovalTarget target={target} />}

                {entry.preview?.kind === 'diff' && (
                    <div className="px-3 pb-2">
                        <DiffView original={entry.preview.original} updated={entry.preview.updated} />
                    </div>
                )}

                {entry.preview?.kind === 'server' && (
                    <div className="px-3 pb-2">
                        <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2">
                            <User className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-faint)]" />
                            <span className="truncate text-xs font-medium text-[var(--color-ink)]">
                                {entry.preview.name}
                            </span>
                            {entry.preview.owner && (
                                <span className="truncate text-xs text-[var(--color-ink-muted)]">
                                    {m['server.ai.approval.ownedBy']({ owner: entry.preview.owner })}
                                </span>
                            )}
                            <span className="ml-auto shrink-0 font-mono text-[11px] text-[var(--color-ink-faint)]">
                                {entry.preview.identifier}
                            </span>
                        </div>
                    </div>
                )}

                {entry.preview?.kind === 'confirmation' && (
                    <div className="px-3 pb-2">
                        <div className="flex items-center gap-2 rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-2">
                            <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-[var(--color-danger)]" />
                            <span className="truncate text-xs font-medium text-[var(--color-ink)]">
                                {entry.preview.name}
                            </span>
                            <span className="ml-auto shrink-0 font-mono text-[11px] text-[var(--color-ink-faint)]">
                                {entry.preview.identifier}
                            </span>
                        </div>
                    </div>
                )}

                {entry.preview?.kind === 'batch' && (
                    <BatchPreview preview={entry.preview} redactions={redactions} className="px-3 pb-2" />
                )}

                <ToolArgs args={remaining} redactions={redactions} className="px-3 pb-2" />

                {entry.submission === 'failed' && (
                    <p className="px-3 pb-2 text-xs text-[var(--color-danger)]">
                        {m['server.ai.decision.retry']()}
                    </p>
                )}

                <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-3 py-2">
                    <Button size="sm" variant="ghost" disabled={disabled || submitting} onClick={() => onDecide('reject')}>
                        {m['server.ai.approval.decline']()}
                    </Button>
                    <Button
                        size="sm"
                        variant={destructive ? 'danger' : 'primary'}
                        disabled={disabled || submitting}
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
                            disabled={!confirmMatches || disabled || submitting}
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
                                server: requiredConfirmation,
                            })}
                        </p>
                    </div>

                    {target && (
                        <ExactApprovalTarget target={target} />
                    )}

                    <Field label={m['server.ai.approval.confirmLabel']({ server: requiredConfirmation })}>
                        <Input
                            value={typed}
                            onChange={e => setTyped(e.target.value)}
                            placeholder={requiredConfirmation}
                            autoFocus
                        />
                    </Field>
                </div>
            </Modal>
        </>
    );
}

/**
 * The exact subject of the approval, separate from the compact header label.
 *
 * Horizontal scrolling keeps every code point available without letting a long
 * path widen the card. Both the container direction and the bdi boundary are
 * deliberate: a target containing RLO/LRO or isolate controls must not reorder
 * the surrounding approval UI. The data attribute gives tests and assistive
 * integrations an unmodified programmatic value as well as the visible text.
 */
function ExactApprovalTarget({ target }: { target: string }) {
    return (
        <pre
            data-ai-approval-target={target}
            dir="ltr"
            className="mx-3 mb-2 overflow-x-auto whitespace-pre rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-2 font-mono text-xs text-[var(--color-ink)]"
            style={{ unicodeBidi: 'isolate' }}
        >
            <bdi dir="ltr">{target}</bdi>
        </pre>
    );
}

/**
 * Which arguments the preview has already accounted for.
 *
 * Listing them again below it is not merely redundant — it is actively worse
 * than the JSON block this replaced, because a reader who has just been shown
 * the file as a diff and then sees `content` spelled out underneath reasonably
 * wonders whether they are two different things.
 */
function spokenFor(preview: AiApprovalPreview | null): Set<string> {
    if (preview?.kind === 'diff') return new Set(['file', 'content', 'original_content']);
    if (preview?.kind === 'server') return new Set(['server']);
    // `on_error` is left out of this set deliberately, so it still renders as a
    // labelled row underneath: whether a failure stops the rest is part of what
    // is being agreed to, and the list above cannot show it.
    if (preview?.kind === 'batch') return new Set(['calls', 'summary']);

    return new Set();
}

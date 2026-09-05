import { useState } from 'react';
import { ChevronDown, Copy, RotateCcw, Trash2 } from 'lucide-react';
import { m } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/format';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import type { FailedJob } from '@/api/adminQueues';

/**
 * One failure, in reading order.
 *
 * The old view was a bare <pre> painted with a CSS variable that does not exist
 * (`--color-surface-raised`), so the trace rendered transparent, unwrapped and
 * in muted ink -- which is most of why errors here were unreadable. This lays
 * the same information out as a diagnosis instead: identity, then the
 * exception, then the frames that are ours, then the vendor frames and the
 * payload folded away. Nothing is hidden behind a tab you have to know to
 * click; the order itself is the explanation.
 */
export function FailedJobModal({
    job,
    detail,
    onClose,
    onRetry,
    onDelete,
    canRetry,
    canDelete,
}: {
    job: FailedJob | null;
    detail: FailedJob | undefined;
    onClose: () => void;
    onRetry: (job: FailedJob) => void;
    onDelete: (job: FailedJob) => void;
    canRetry: boolean;
    canDelete: boolean;
}) {
    const [copied, setCopied] = useState(false);
    const trace = detail?.exception ?? null;

    const copyTrace = async () => {
        if (!trace) return;

        try {
            await navigator.clipboard.writeText(trace);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard access can be refused outright; the trace is selectable
            // in the block above either way, so there is nothing to recover.
        }
    };

    return (
        <Modal
            open={job !== null}
            onClose={onClose}
            title={job?.title ?? ''}
            description={job?.job}
            size="lg"
            dismissible
            footer={
                <div className="flex w-full items-center gap-2">
                    <Button variant="ghost" size="sm" onClick={copyTrace} disabled={!trace}>
                        <Copy className="h-3.5 w-3.5" />
                        {copied ? m['admin.queues.failed.copied']() : m['admin.queues.failed.copyTrace']()}
                    </Button>

                    <div className="ml-auto flex items-center gap-2">
                        {canDelete && job && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => onDelete(job)}
                                className="text-[var(--color-danger)] hover:bg-[var(--color-danger)]/10 hover:text-[var(--color-danger)]"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                                {m['admin.queues.failed.delete']()}
                            </Button>
                        )}
                        {canRetry && job && (
                            <Button size="sm" onClick={() => onRetry(job)}>
                                <RotateCcw className="h-3.5 w-3.5" />
                                {m['admin.queues.failed.retry']()}
                            </Button>
                        )}
                    </div>
                </div>
            }
        >
            {job === null ? null : (
                <div className="space-y-4">
                    <dl className="grid grid-cols-2 overflow-hidden rounded-md border border-[var(--color-border)] sm:grid-cols-4">
                        <Field label={m['admin.queues.col.lane']()} value={job.lane ?? job.queue} />
                        <Field label={m['admin.queues.failed.col.connection']()} value={job.connection} />
                        <Field
                            label={m['admin.queues.failed.col.attempts']()}
                            value={job.attempts === null ? '—' : String(job.attempts)}
                        />
                        <Field
                            label={m['admin.queues.failed.col.when']()}
                            value={job.failedAt ? timeAgo(job.failedAt) : '—'}
                        />
                    </dl>

                    {job.summary && (
                        <p className="text-sm leading-relaxed text-[var(--color-ink-muted)]">{job.summary}</p>
                    )}

                    <div className="rounded-r-md border-l-2 border-[var(--color-danger)] bg-[var(--color-danger)]/10 px-3.5 py-3">
                        {job.exceptionClass && (
                            <p className="font-mono text-[11px] text-[var(--color-danger)]">{job.exceptionClass}</p>
                        )}
                        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--color-ink)]">
                            {job.exceptionMessage}
                        </p>
                    </div>

                    <Section label={m['admin.queues.failed.trace']()}>
                        {detail === undefined ? (
                            <div className="flex justify-center py-6">
                                <Spinner />
                            </div>
                        ) : (
                            <Trace trace={trace} />
                        )}
                    </Section>

                    {detail?.payload && (
                        <Collapsible label={m['admin.queues.failed.payload']()} note={m['admin.queues.failed.payloadRedacted']()}>
                            <pre className="max-h-64 overflow-auto rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 font-mono text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
                                {JSON.stringify(detail.payload, null, 2)}
                            </pre>
                        </Collapsible>
                    )}
                </div>
            )}
        </Modal>
    );
}

/**
 * The trace, with our frames separated from the vendor ones.
 *
 * A Laravel trace is mostly framework internals; the two or three lines under
 * `app/` are the whole reason anyone opens it. Those stay visible and marked,
 * the rest collapses to a count.
 */
function Trace({ trace }: { trace: string | null }) {
    const [showVendor, setShowVendor] = useState(false);

    if (!trace) {
        return <p className="text-sm text-[var(--color-ink-faint)]">{m['admin.queues.failed.noTrace']()}</p>;
    }

    const lines = trace.split('\n');
    const vendorCount = lines.filter(line => isVendorFrame(line)).length;
    const visible = showVendor ? lines : lines.filter(line => !isVendorFrame(line));

    return (
        <>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 font-mono text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
                {visible.map((line, index) => (
                    <span
                        key={index}
                        className={cn('block', isAppFrame(line) && 'rounded bg-[var(--brand)]/20 text-[var(--color-ink)]')}
                    >
                        {line}
                    </span>
                ))}
            </pre>

            {vendorCount > 0 && (
                <button
                    type="button"
                    onClick={() => setShowVendor(value => !value)}
                    aria-expanded={showVendor}
                    className="mt-1.5 inline-flex items-center gap-1 font-mono text-[11px] text-[var(--color-ink-faint)] hover:text-[var(--color-ink-muted)]"
                >
                    <ChevronDown className={cn('h-3 w-3 transition-transform', showVendor && 'rotate-180')} />
                    {showVendor
                        ? m['admin.queues.failed.hideVendor']()
                        : m['admin.queues.failed.showVendor']({ count: vendorCount })}
                </button>
            )}
        </>
    );
}

// Frame classification is textual on purpose: the trace arrives as a rendered
// string, and matching the path prefix is both what an operator does by eye and
// the only thing available here.
function isVendorFrame(line: string): boolean {
    return line.includes('/vendor/') || line.includes('\\vendor\\');
}

function isAppFrame(line: string): boolean {
    return !isVendorFrame(line) && /(^|[\s(/])app\//.test(line);
}

function Field({ label, value }: { label: string; value: string }) {
    return (
        <div className="border-b border-r border-[var(--color-border)] px-3 py-2 last:border-r-0 sm:border-b-0">
            <dt className="text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)]">{label}</dt>
            <dd className="mt-0.5 font-mono text-xs text-[var(--color-ink)]">{value}</dd>
        </div>
    );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div>
            <div className="mb-2 flex items-center gap-2.5">
                <span className="text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)]">{label}</span>
                <span className="h-px flex-1 bg-[var(--color-border)]" />
            </div>
            {children}
        </div>
    );
}

function Collapsible({ label, note, children }: { label: string; note: string; children: React.ReactNode }) {
    const [open, setOpen] = useState(false);

    return (
        <div>
            <div className="mb-2 flex items-center gap-2.5">
                <button
                    type="button"
                    onClick={() => setOpen(value => !value)}
                    aria-expanded={open}
                    className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)] hover:text-[var(--color-ink-muted)]"
                >
                    <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
                    {label}
                </button>
                <span className="h-px flex-1 bg-[var(--color-border)]" />
                <span className="font-mono text-[10px] text-[var(--color-ink-faint)]">{note}</span>
            </div>
            {open && children}
        </div>
    );
}

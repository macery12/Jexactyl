import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';

// Inline diff for file-write activity entries. The backend attaches a parsed
// unified diff (hunks + per-line changes) under properties.diff on
// server:file.write / server:sftp.write events; large files arrive with the
// stats but no hunks.

interface DiffChange {
    type: 'addition' | 'deletion' | 'context';
    content: string;
}

interface DiffHunk {
    old_start: number;
    old_lines: number;
    new_start: number;
    new_lines: number;
    context: string;
    changes: DiffChange[];
}

export interface FileDiff {
    file?: string;
    additions: number;
    deletions: number;
    hunks: DiffHunk[];
    is_new_file?: boolean;
    large_file?: boolean;
}

function DiffStats({ additions, deletions }: { additions: number; deletions: number }) {
    return (
        <span className="flex shrink-0 items-center gap-2 font-mono text-xs">
            <span className="text-[var(--color-accent)]">+{additions}</span>
            <span className="text-[var(--color-danger)]">-{deletions}</span>
        </span>
    );
}

function DiffLine({ change, lineNumber }: { change: DiffChange; lineNumber: number }) {
    const isAdd = change.type === 'addition';
    const isDel = change.type === 'deletion';

    return (
        <div
            className={cn(
                'flex border-l-2',
                isAdd && 'border-[var(--color-accent)] bg-[var(--color-accent)]/10',
                isDel && 'border-[var(--color-danger)] bg-[var(--color-danger)]/10',
                !isAdd && !isDel && 'border-transparent',
            )}
        >
            <span className="w-12 shrink-0 select-none border-r border-[var(--color-border)] px-2 text-right font-mono text-[11px] text-[var(--color-ink-faint)]">
                {lineNumber}
            </span>
            <span
                className={cn(
                    'w-5 shrink-0 select-none text-center font-mono text-[11px]',
                    isAdd && 'text-[var(--color-accent)]',
                    isDel && 'text-[var(--color-danger)]',
                    !isAdd && !isDel && 'text-[var(--color-ink-faint)]',
                )}
            >
                {isAdd ? '+' : isDel ? '-' : ' '}
            </span>
            <pre className="min-w-0 flex-1 whitespace-pre-wrap break-all px-2 font-mono text-[11px] text-[var(--color-ink-muted)]">
                {change.content || ' '}
            </pre>
        </div>
    );
}

function DiffHunkView({ hunk }: { hunk: DiffHunk }) {
    const [expanded, setExpanded] = useState(true);

    // Deletions advance the old-file counter, additions the new one, context both.
    let oldLine = hunk.old_start;
    let newLine = hunk.new_start;

    return (
        <div className="mb-2 overflow-hidden rounded-md border border-[var(--color-border)] last:mb-0">
            <button
                type="button"
                onClick={() => setExpanded(e => !e)}
                className="flex w-full items-center gap-2 bg-[var(--color-surface-2)] px-3 py-2 font-mono text-xs text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-border-strong)]"
            >
                {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                <span>
                    @@ -{hunk.old_start},{hunk.old_lines} +{hunk.new_start},{hunk.new_lines} @@
                </span>
                {hunk.context && <span className="truncate text-[var(--color-ink-faint)]">{hunk.context}</span>}
            </button>
            {expanded && (
                <div className="bg-[var(--color-canvas)]">
                    {hunk.changes.map((change, i) => {
                        let lineNumber: number;
                        if (change.type === 'deletion') {
                            lineNumber = oldLine++;
                        } else {
                            if (change.type === 'context') oldLine++;
                            lineNumber = newLine++;
                        }
                        return <DiffLine key={i} change={change} lineNumber={lineNumber} />;
                    })}
                </div>
            )}
        </div>
    );
}

export default function FileDiffViewer({ diff }: { diff: FileDiff }) {
    const [open, setOpen] = useState(false);
    const filename = diff.file || m['server.activity.diff.unknownFile']();

    if (diff.large_file) {
        return (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
                <span className="flex min-w-0 items-center gap-3">
                    <span className="truncate font-mono text-xs text-[var(--color-ink-muted)]">{filename}</span>
                    <DiffStats additions={diff.additions} deletions={diff.deletions} />
                </span>
                <span className="text-xs text-[var(--color-ink-faint)]">{m['server.activity.diff.tooLarge']()}</span>
            </div>
        );
    }

    if (diff.hunks.length === 0) {
        return (
            <div className="flex min-w-0 items-center gap-3 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
                <span className="truncate font-mono text-xs text-[var(--color-ink-muted)]">{filename}</span>
                {diff.is_new_file ? (
                    <span className="shrink-0 rounded-full bg-[var(--color-accent)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--color-accent)]">
                        {m['server.activity.diff.newFile']()}
                    </span>
                ) : (
                    <DiffStats additions={diff.additions} deletions={diff.deletions} />
                )}
            </div>
        );
    }

    return (
        <div className="overflow-hidden rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="flex w-full items-center justify-between gap-3 px-3 py-2 transition-colors hover:bg-[var(--color-border-strong)]"
            >
                <span className="flex min-w-0 items-center gap-2">
                    {open ? (
                        <ChevronDown className="h-4 w-4 shrink-0 text-[var(--color-ink-faint)]" />
                    ) : (
                        <ChevronRight className="h-4 w-4 shrink-0 text-[var(--color-ink-faint)]" />
                    )}
                    <span className="truncate font-mono text-xs text-[var(--color-ink-muted)]">{filename}</span>
                    {diff.is_new_file && (
                        <span className="shrink-0 rounded-full bg-[var(--color-accent)]/10 px-2 py-0.5 text-[10px] font-medium text-[var(--color-accent)]">
                            {m['server.activity.diff.newFile']()}
                        </span>
                    )}
                </span>
                <DiffStats additions={diff.additions} deletions={diff.deletions} />
            </button>
            {open && (
                <div className="border-t border-[var(--color-border)] p-3">
                    {diff.hunks.map((hunk, i) => (
                        <DiffHunkView key={i} hunk={hunk} />
                    ))}
                </div>
            )}
        </div>
    );
}

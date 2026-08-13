import { useState } from 'react';
import { AlertTriangle, Check, ChevronRight, X } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import { Spinner } from '@/components/ui/Spinner';
import type { ChatEntry } from '@/state/agentChat';
import { ToolIcon, toolLabel, toolTarget } from './toolMeta';

type ToolEntry = Extract<ChatEntry, { kind: 'tool' }>;

// One tool step, as a single line.
//
// A turn can run twelve of these, so the collapsed form has to stay scannable:
// verb, target, outcome. Everything else — the full arguments — is one click
// away rather than on screen by default.
export function ToolCallRow({ entry }: { entry: ToolEntry }) {
    const [open, setOpen] = useState(false);

    const target = toolTarget(entry.tool, entry.args);
    const hasArgs = Object.keys(entry.args).length > 0;

    return (
        <div className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)]/40">
            <button
                type="button"
                onClick={() => hasArgs && setOpen(o => !o)}
                disabled={!hasArgs}
                className={cn(
                    'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs',
                    hasArgs && 'transition-colors hover:bg-[var(--color-surface-2)]',
                )}
            >
                <ChevronRight
                    className={cn(
                        'h-3 w-3 shrink-0 text-[var(--color-ink-faint)] transition-transform',
                        !hasArgs && 'invisible',
                        open && 'rotate-90',
                    )}
                />
                <ToolIcon tool={entry.tool} className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-muted)]" />

                <span className="shrink-0 font-medium text-[var(--color-ink)]">{toolLabel(entry.tool)}</span>

                {target && (
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-[var(--color-ink-muted)]">
                        {target}
                    </span>
                )}
                {!target && <span className="flex-1" />}

                {entry.risk === 'destructive' && entry.status !== 'running' && (
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[var(--color-warning)]" />
                )}

                {entry.status === 'running' ? (
                    <Spinner className="h-3.5 w-3.5 shrink-0" />
                ) : (
                    <span
                        className={cn(
                            'flex shrink-0 items-center gap-1 text-[11px]',
                            entry.status === 'ok' ? 'text-[var(--color-ink-faint)]' : 'text-[var(--color-danger)]',
                        )}
                    >
                        {entry.summary && <span className="max-w-[16rem] truncate">{entry.summary}</span>}
                        {entry.status === 'ok' ? (
                            <Check className="h-3.5 w-3.5 text-[var(--color-accent)]" />
                        ) : (
                            <X className="h-3.5 w-3.5" />
                        )}
                    </span>
                )}
            </button>

            {open && hasArgs && (
                <div className="border-t border-[var(--color-border)] px-2.5 py-2">
                    <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[var(--color-ink-faint)]">
                        {m['server.ai.tool.arguments']()}
                    </p>
                    <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
                        {JSON.stringify(entry.args, null, 2)}
                    </pre>
                </div>
            )}
        </div>
    );
}

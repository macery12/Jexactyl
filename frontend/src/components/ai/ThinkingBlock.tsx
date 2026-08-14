import { useState } from 'react';
import { Brain, ChevronRight } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import type { ChatEntry } from '@/state/agentChat';

type ReasoningEntry = Extract<ChatEntry, { kind: 'reasoning' }>;

// The model's own reasoning, collapsed.
//
// Collapsed by default and visually quieter than the answer, because it is
// working-out rather than a conclusion: useful when a step surprises you, noise
// when it doesn't. Reasoning is also not always well-formed prose, so it renders
// as plain preformatted text rather than through the markdown pipeline — a
// half-finished heading or list marker mid-thought would otherwise reformat the
// block as it streams.
//
// It stays expanded while streaming so a long think is visibly progressing, then
// collapses to a one-line summary once the duration is known.
export function ThinkingBlock({ entry }: { entry: ReasoningEntry }) {
    const [open, setOpen] = useState(false);
    const expanded = open || Boolean(entry.streaming);

    return (
        <div className="text-[var(--color-ink-muted)]">
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="flex items-center gap-1.5 text-xs text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink-muted)]"
            >
                <ChevronRight
                    className={cn('h-3 w-3 shrink-0 transition-transform', expanded && 'rotate-90')}
                />
                <Brain className={cn('h-3.5 w-3.5 shrink-0', entry.streaming && 'animate-pulse')} />
                <span>
                    {entry.streaming
                        ? m['server.ai.reasoning.active']()
                        : m['server.ai.reasoning.done']({ seconds: entry.seconds ?? 1 })}
                </span>
            </button>

            {expanded && entry.content.trim() !== '' && (
                <div className="ml-[0.6875rem] mt-1.5 border-l border-[var(--color-border)] pl-3">
                    <p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[var(--color-ink-faint)]">
                        {entry.content}
                    </p>
                </div>
            )}
        </div>
    );
}

import { useState } from 'react';
import { m } from '@/i18n/messages';
import { cn } from '@/lib/cn';

// What you said, as something you said.
//
// It used to be the first line of the turn, at the heaviest weight on screen,
// flush left with everything else indented beneath it — which is the shape of a
// section heading in every document anyone has ever read, and so that is what it
// looked like. Four signals were saying "title" at once: heading position,
// heaviest weight, no attribution, no edges.
//
// Alignment fixes three of them at a stroke, and it is the one speech signal
// that costs no width — which is why it still works on a phone, where a tinted
// left-aligned block fills the column and stops reading as a message at all.
// It also makes the assistant's reply free: everything on the left is the
// assistant, by position, so the answer needs no avatar and no name.
//
// The fill is deliberately not `--color-surface-2`. That is what the old bubble
// used, and it was the same fill as a tool row — the two least similar things in
// the transcript wearing one colour. A faint shift toward brand keeps it unique
// to user messages in every theme, without spending the accent itself: colour
// here is rationed to the pending approval, which is the only thing that is
// actionable.

/** Beyond this many lines a message is clamped rather than shown whole. */
const CLAMP_LINES = 6;

export function UserMessage({ content, speaker }: { content: string; speaker?: string }) {
    const [expanded, setExpanded] = useState(false);

    // People paste crash logs in here — two hundred lines of stack trace, pinned
    // to the right edge, is a wall rather than a message. The count in the
    // control is the useful half: it says whether opening it is worth the scroll
    // before you commit to it.
    const lines = content.split('\n');
    const clampable = lines.length > CLAMP_LINES;
    const pasted = lines.length > 2;

    return (
        <div className="flex flex-col items-end gap-1 self-end">
            {speaker && (
                <span className="pr-0.5 font-mono text-[9.5px] uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">
                    {speaker}
                </span>
            )}

            <div
                className={cn(
                    'max-w-[min(46ch,80%)] whitespace-pre-wrap break-words px-3.5 py-2 text-[13.5px] leading-relaxed text-[var(--color-ink)]',
                    // Three rounded corners and a tucked-in bottom-right points
                    // the block back at the composer it came from, which is the
                    // direction the eye is already travelling. Not a bubble — a
                    // block with a corner taken off.
                    'rounded-[0.625rem] rounded-br-[0.1875rem]',
                    pasted && 'font-mono text-[11.5px]',
                    clampable && !expanded && 'max-h-[9.5rem] overflow-hidden',
                )}
                style={{
                    background: 'color-mix(in oklab, var(--color-surface-2) 88%, var(--brand))',
                    ...(clampable && !expanded
                        ? {
                              maskImage: 'linear-gradient(to bottom, #000 62%, transparent)',
                              WebkitMaskImage: 'linear-gradient(to bottom, #000 62%, transparent)',
                          }
                        : {}),
                }}
            >
                {content}
            </div>

            {clampable && (
                <button
                    type="button"
                    onClick={() => setExpanded(open => !open)}
                    className="rounded-sm border border-[var(--color-border-strong)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--brand-bright)] transition-colors hover:bg-[var(--color-surface-2)]"
                >
                    {expanded
                        ? m['server.ai.paste.showLess']()
                        : m['server.ai.paste.showAll']({ count: lines.length })}
                </button>
            )}
        </div>
    );
}

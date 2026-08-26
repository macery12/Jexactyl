import { forwardRef, useCallback, type KeyboardEvent } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { m } from '@/i18n/messages';
import { cn } from '@/lib/cn';

// The composer, as a prompt rather than a pill.
//
// It was a rounded card with its own border and a `shadow-lg` that is invisible
// on a dark canvas, floating above a transcript that is itself inside a bordered
// box — three nested containers to type one sentence into. Here it is a hairline
// and a caret: the same device the transcript uses to separate turns, so the
// composer reads as the bottom of the conversation rather than as a widget
// parked underneath it.
//
// Enter sends and Shift+Enter breaks the line, unchanged. The action button
// still flips to a stop while a turn is streaming — that is not cosmetic, it
// stops the turn on the server, and the label is the only thing that says so.
export const ChatComposer = forwardRef<
    HTMLTextAreaElement,
    {
        value: string;
        onChange: (value: string) => void;
        onSend: () => void;
        onCancel: () => void;
        loading: boolean;
        placeholder: string;
        disabled?: boolean;
    }
>(({ value, onChange, onSend, onCancel, loading, placeholder, disabled }, ref) => {
    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!loading) onSend();
        }
    };

    const autoGrow = useCallback((el: HTMLTextAreaElement | null) => {
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }, []);

    const canSend = value.trim().length > 0 && !loading && !disabled;

    return (
        <div className="flex shrink-0 items-end gap-2.5 border-t border-[var(--color-border-strong)] px-4 py-2.5 focus-within:border-[var(--brand)]/40">
            <span
                aria-hidden
                className="select-none py-1.5 font-mono text-[13px] leading-relaxed text-[var(--brand-bright)]"
            >
                ›
            </span>

            <textarea
                ref={node => {
                    autoGrow(node);
                    if (typeof ref === 'function') ref(node);
                    else if (ref) ref.current = node;
                }}
                rows={1}
                value={value}
                disabled={disabled}
                placeholder={placeholder}
                onChange={e => {
                    onChange(e.target.value);
                    autoGrow(e.target);
                }}
                onKeyDown={handleKeyDown}
                className="max-h-[200px] min-h-[24px] flex-1 resize-none bg-transparent py-1 text-[13px] leading-relaxed text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:outline-none disabled:opacity-50"
            />

            {/* The hints are a convenience for people already typing; the button
                is the only way to send at all on a touch keyboard, so it is
                always rendered and the hints are what give way when space is
                short. */}
            {!loading && (
                <span
                    aria-hidden
                    className={cn(
                        'hidden shrink-0 select-none items-center gap-1 pb-1.5 font-mono text-[10px] text-[var(--color-ink-faint)] lg:flex',
                        !canSend && 'opacity-40',
                    )}
                >
                    <kbd className="rounded-sm border border-[var(--color-border-strong)] px-1 py-px">
                        ↵ {m['server.ai.composer.sendHint']()}
                    </kbd>
                    <kbd className="rounded-sm border border-[var(--color-border-strong)] px-1 py-px">
                        ⇧↵ {m['server.ai.composer.newlineHint']()}
                    </kbd>
                </span>
            )}

            {loading ? (
                <button
                    type="button"
                    onClick={onCancel}
                    title={m['server.ai.stop']()}
                    aria-label={m['server.ai.stop']()}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-[var(--color-border-strong)] text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-2)]"
                >
                    <Square className="h-3 w-3 fill-current" />
                </button>
            ) : (
                <button
                    type="button"
                    onClick={onSend}
                    disabled={!canSend}
                    title={m['common.actions.send']()}
                    aria-label={m['common.actions.send']()}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-[var(--brand)] text-[var(--color-brand-ink)] transition-colors hover:bg-[var(--brand-hover)] disabled:opacity-25"
                >
                    <ArrowUp className="h-3.5 w-3.5" />
                </button>
            )}
        </div>
    );
});
ChatComposer.displayName = 'ChatComposer';

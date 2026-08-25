import { forwardRef, useCallback, type KeyboardEvent } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { m } from '@/i18n/messages';

// ChatGPT-style composer pill: auto-growing textarea with Enter-to-send
// (Shift+Enter for a newline) and a circular action button that flips
// between send and stop while a response is streaming.
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
        <div className="rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-2 shadow-lg shadow-black/5 focus-within:border-[var(--brand)]/50">
            <div className="flex items-end gap-2">
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
                    className="max-h-[200px] min-h-[40px] flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-relaxed text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:outline-none disabled:opacity-50"
                />
                {loading ? (
                    <button
                        type="button"
                        onClick={onCancel}
                        // Not "cancel": this now stops the turn on the server
                        // rather than only closing the browser's reader, and
                        // the label is the only thing that says which.
                        title={m['server.ai.stop']()}
                        aria-label={m['server.ai.stop']()}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-ink)] transition-colors hover:bg-[var(--color-border-strong)]"
                    >
                        <Square className="h-3.5 w-3.5 fill-current" />
                    </button>
                ) : (
                    <button
                        type="button"
                        onClick={onSend}
                        disabled={!canSend}
                        title={m['common.actions.send']()}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-[var(--color-brand-ink)] transition-all hover:bg-[var(--brand-hover)] disabled:opacity-30"
                    >
                        <ArrowUp className="h-4 w-4" />
                    </button>
                )}
            </div>
        </div>
    );
});
ChatComposer.displayName = 'ChatComposer';

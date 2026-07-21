import * as Popover from '@radix-ui/react-popover';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/cn';
import { m } from '@/i18n';
import { Spinner } from './Spinner';

export interface ComboboxOption {
    value: string;
    label: string;
    /** Optional second line — e.g. an email under a username. */
    hint?: string;
}

// Searchable single-select. Deliberately built on Popover rather than Select:
// Select's portalled content sits outside the dialog it renders in, and its
// closing click could land on a Dialog overlay and dismiss the whole form.
//
// Unlike Select this renders explicit loading / empty / error states. A picker
// that silently shows zero rows is indistinguishable from a failed request, and
// that is exactly how the broken deployable-nodes query hid for so long.
export function Combobox({
    value,
    onChange,
    options,
    placeholder,
    searchPlaceholder,
    disabled,
    invalid,
    loading = false,
    error,
    emptyMessage,
    onSearch,
    id,
    className,
}: {
    value: string | undefined;
    onChange: (value: string) => void;
    options: ComboboxOption[];
    placeholder?: string;
    searchPlaceholder?: string;
    disabled?: boolean;
    invalid?: boolean;
    loading?: boolean;
    /** Non-null renders in place of the list — the query failed, say why. */
    error?: string | null;
    emptyMessage?: string;
    /**
     * Server-side search. When provided the list is assumed pre-filtered and the
     * query is forwarded (debounced); when omitted the options are filtered
     * client-side on label + hint.
     */
    onSearch?: (query: string) => void;
    id?: string;
    className?: string;
}) {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    // Debounce the outward search so typing doesn't fire a request per keystroke.
    useEffect(() => {
        if (!onSearch) return;
        const t = setTimeout(() => onSearch(query), 250);
        return () => clearTimeout(t);
    }, [query, onSearch]);

    const visible = useMemo(() => {
        if (onSearch) return options;
        const q = query.trim().toLowerCase();
        if (!q) return options;
        return options.filter(o => o.label.toLowerCase().includes(q) || o.hint?.toLowerCase().includes(q));
    }, [options, query, onSearch]);

    const selected = options.find(o => o.value === value);

    // Clear the query on open so a stale filter can't make the list look empty
    // next time. Done in the event handler rather than an effect — an effect
    // here would fire a second render pass on every open.
    const onOpenChange = (next: boolean) => {
        if (next) {
            setQuery('');
            requestAnimationFrame(() => inputRef.current?.focus());
        }
        setOpen(next);
    };

    return (
        <Popover.Root open={open} onOpenChange={onOpenChange}>
            <Popover.Trigger
                id={id}
                type="button"
                disabled={disabled}
                data-field-focus
                className={cn(
                    'flex h-11 w-full items-center justify-between gap-2 rounded-lg border bg-[var(--color-surface-2)] px-4 text-sm',
                    'transition-colors focus:outline-none focus:ring-1 focus:ring-[var(--color-focus-ring)] disabled:opacity-50',
                    selected ? 'text-[var(--color-ink)]' : 'text-[var(--color-ink-faint)]',
                    invalid
                        ? 'border-[var(--color-danger)]'
                        : 'border-[var(--color-border-strong)] focus:border-[var(--color-focus)]',
                    className,
                )}
            >
                <span className="truncate">{selected?.label ?? placeholder}</span>
                <ChevronDown className="h-4 w-4 shrink-0 text-[var(--color-ink-faint)]" />
            </Popover.Trigger>
            <Popover.Portal>
                <Popover.Content
                    align="start"
                    sideOffset={6}
                    className="z-[60] w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-xl shadow-black/30"
                >
                    <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-3">
                        <Search className="h-4 w-4 shrink-0 text-[var(--color-ink-faint)]" />
                        <input
                            ref={inputRef}
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder={searchPlaceholder ?? m['common.actions.search']()}
                            className="h-10 w-full bg-transparent text-sm text-[var(--color-ink)] placeholder:text-[var(--color-ink-faint)] focus:outline-none"
                        />
                    </div>

                    <div className="max-h-64 overflow-y-auto p-1">
                        {error ? (
                            <p className="px-3 py-6 text-center text-xs text-[var(--color-danger)]">{error}</p>
                        ) : loading ? (
                            <div className="flex items-center justify-center py-6">
                                <Spinner className="h-4 w-4" />
                            </div>
                        ) : visible.length === 0 ? (
                            <p className="px-3 py-6 text-center text-xs text-[var(--color-ink-faint)]">
                                {emptyMessage ?? m['common.combobox.noResults']()}
                            </p>
                        ) : (
                            visible.map(o => (
                                <button
                                    key={o.value}
                                    type="button"
                                    onClick={() => {
                                        onChange(o.value);
                                        setOpen(false);
                                    }}
                                    className={cn(
                                        'relative flex w-full items-center gap-2 rounded-lg py-2 pl-3 pr-8 text-left text-sm outline-none',
                                        'hover:bg-[var(--color-surface-2)] focus:bg-[var(--color-surface-2)]',
                                        o.value === value ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink)]',
                                    )}
                                >
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate">{o.label}</span>
                                        {o.hint && <span className="block truncate text-xs text-[var(--color-ink-faint)]">{o.hint}</span>}
                                    </span>
                                    {o.value === value && <Check className="absolute right-2 h-4 w-4" />}
                                </button>
                            ))
                        )}
                    </div>
                </Popover.Content>
            </Popover.Portal>
        </Popover.Root>
    );
}

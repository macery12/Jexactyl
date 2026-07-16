import * as RSelect from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface SelectOption {
    value: string;
    label: string;
}

// Themed single-select built on Radix. Trigger mirrors Input.tsx chrome so it
// sits naturally inside the admin forms.
export function Select({
    value,
    onChange,
    options,
    placeholder,
    disabled,
    invalid,
    id,
    className,
}: {
    value: string | undefined;
    onChange: (value: string) => void;
    options: SelectOption[];
    placeholder?: string;
    disabled?: boolean;
    invalid?: boolean;
    id?: string;
    className?: string;
}) {
    return (
        <RSelect.Root value={value} onValueChange={onChange} disabled={disabled}>
            <RSelect.Trigger
                id={id}
                className={cn(
                    'flex h-11 w-full items-center justify-between gap-2 rounded-xl border bg-[var(--color-surface-2)] px-4 text-sm text-[var(--color-ink)]',
                    'transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--brand)]/60 disabled:opacity-50',
                    'data-[placeholder]:text-[var(--color-ink-faint)]',
                    invalid ? 'border-[var(--color-danger)]' : 'border-[var(--color-border-strong)]',
                    className,
                )}
            >
                <RSelect.Value placeholder={placeholder} />
                <RSelect.Icon>
                    <ChevronDown className="h-4 w-4 text-[var(--color-ink-faint)]" />
                </RSelect.Icon>
            </RSelect.Trigger>
            <RSelect.Portal>
                <RSelect.Content
                    position="popper"
                    sideOffset={6}
                    className="z-[60] max-h-72 w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] shadow-xl shadow-black/30"
                >
                    <RSelect.Viewport className="p-1">
                        {options.map(o => (
                            <RSelect.Item
                                key={o.value}
                                value={o.value}
                                className="relative flex cursor-pointer select-none items-center rounded-lg py-2 pl-3 pr-8 text-sm text-[var(--color-ink)] outline-none data-[highlighted]:bg-[var(--color-surface-2)] data-[state=checked]:text-[var(--color-accent)]"
                            >
                                <RSelect.ItemText>{o.label}</RSelect.ItemText>
                                <RSelect.ItemIndicator className="absolute right-2 inline-flex items-center">
                                    <Check className="h-4 w-4" />
                                </RSelect.ItemIndicator>
                            </RSelect.Item>
                        ))}
                    </RSelect.Viewport>
                </RSelect.Content>
            </RSelect.Portal>
        </RSelect.Root>
    );
}

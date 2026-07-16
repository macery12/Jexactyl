import { useEffect, useRef, useState } from 'react';
import { searchAddress, type AddressSuggestion } from '@/api/routes/account/billing/addressAutocomplete';

interface Props {
    value: string;
    onChange: (value: string) => void;
    onSelect: (suggestion: AddressSuggestion) => void;
    placeholder?: string;
    disabled?: boolean;
}

/**
 * Typeahead input that searches for address suggestions via the Nominatim proxy.
 * On selecting a suggestion the `onSelect` callback receives the structured
 * suggestion so the parent form can fill the individual address fields.
 */
export default function AddressAutocompleteInput({ value, onChange, onSelect, placeholder, disabled }: Props) {
    const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);

        if (value.length < 3) {
            setSuggestions([]);
            setOpen(false);
            return;
        }

        debounceRef.current = setTimeout(async () => {
            setLoading(true);
            try {
                const results = await searchAddress(value);
                setSuggestions(results);
                setOpen(results.length > 0);
            } catch {
                setSuggestions([]);
                setOpen(false);
            } finally {
                setLoading(false);
            }
        }, 300);

        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, [value]);

    // Close dropdown on outside click
    useEffect(() => {
        const handler = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, []);

    const handleSelect = (suggestion: AddressSuggestion) => {
        onChange(suggestion.line1 || value);
        onSelect(suggestion);
        setSuggestions([]);
        setOpen(false);
    };

    return (
        <div ref={containerRef} className={'relative'}>
            <div className={'relative'}>
                <input
                    type={'text'}
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    placeholder={placeholder ?? 'Search for your address…'}
                    disabled={disabled}
                    autoComplete={'off'}
                    className={
                        'w-full rounded border border-neutral-600 bg-neutral-700 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50'
                    }
                />
                {loading && (
                    <span className={'absolute right-3 top-1/2 -translate-y-1/2 text-xs text-neutral-400'}>
                        Searching…
                    </span>
                )}
            </div>

            {open && suggestions.length > 0 && (
                <ul
                    className={
                        'absolute z-50 mt-1 w-full overflow-hidden rounded border border-neutral-600 bg-neutral-800 shadow-lg'
                    }
                >
                    {suggestions.map((s, i) => (
                        <li key={i}>
                            <button
                                type={'button'}
                                onMouseDown={() => handleSelect(s)}
                                className={
                                    'w-full px-3 py-2 text-left text-sm text-neutral-200 hover:bg-neutral-700 focus:bg-neutral-700 focus:outline-none'
                                }
                            >
                                <span className={'block truncate'}>{s.label}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}

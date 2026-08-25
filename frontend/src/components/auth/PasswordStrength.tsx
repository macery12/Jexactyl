import { forwardRef, useMemo, useState } from 'react';
import { Check, Eye, EyeOff } from 'lucide-react';
import { m } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import { Input, type InputProps } from '@/components/ui/Input';

// Password policy mirrored from the backend (min 12, mixed case, number, symbol).
// `uncompromised` (HIBP) is server-only and surfaced via the API error banner.
const rules = [
    { key: 'length', test: (v: string) => v.length >= 12 },
    { key: 'case', test: (v: string) => /[a-z]/.test(v) && /[A-Z]/.test(v) },
    { key: 'number', test: (v: string) => /\d/.test(v) },
    { key: 'symbol', test: (v: string) => /[^A-Za-z0-9]/.test(v) },
] as const;

/** True when the value satisfies every client-checkable policy rule. */
export function passwordMeetsPolicy(value: string): boolean {
    return rules.every(r => r.test(value));
}

const ruleLabels: Record<(typeof rules)[number]['key'], () => string> = {
    length: () => m['auth.passwordStrength.length'](),
    case: () => m['auth.passwordStrength.case'](),
    number: () => m['auth.passwordStrength.number'](),
    symbol: () => m['auth.passwordStrength.symbol'](),
};

// Password field with a show/hide toggle. Same chrome as <Input> plus a trailing
// eye button.
export const PasswordInput = forwardRef<HTMLInputElement, InputProps>(({ className, ...props }, ref) => {
    const [visible, setVisible] = useState(false);
    return (
        <div className="relative">
            <Input
                ref={ref}
                type={visible ? 'text' : 'password'}
                className={cn('pr-11', className)}
                {...props}
            />
            <button
                type="button"
                onClick={() => setVisible(v => !v)}
                aria-label={visible ? m['auth.passwordStrength.hide']() : m['auth.passwordStrength.show']()}
                className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
            >
                {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
        </div>
    );
});
PasswordInput.displayName = 'PasswordInput';

export function PasswordStrength({ value }: { value: string }) {
    const met = useMemo(() => rules.map(r => r.test(value)), [value]);
    const score = met.filter(Boolean).length;

    const { barTone, label } =
        value.length === 0
            ? { barTone: 'bg-[var(--color-ink-faint)]', label: '' }
            : score <= 1
              ? { barTone: 'bg-[var(--color-danger)]', label: m['auth.passwordStrength.weak']() }
              : score === 2
                ? { barTone: 'bg-[var(--color-warning)]', label: m['auth.passwordStrength.fair']() }
                : score === 3
                  ? { barTone: 'bg-[var(--brand)]', label: m['auth.passwordStrength.good']() }
                  : { barTone: 'bg-[var(--color-accent)]', label: m['auth.passwordStrength.strong']() };

    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                    <div
                        className={cn('h-full rounded-full transition-all duration-300', barTone)}
                        style={{ width: `${(score / rules.length) * 100}%` }}
                    />
                </div>
                {label && <span className="text-xs font-medium text-[var(--color-ink-muted)]">{label}</span>}
            </div>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1">
                {rules.map((r, i) => (
                    <li
                        key={r.key}
                        className={cn(
                            'flex items-center gap-1.5 text-xs transition-colors',
                            met[i] ? 'text-[var(--color-accent)]' : 'text-[var(--color-ink-faint)]',
                        )}
                    >
                        <Check className={cn('h-3.5 w-3.5 shrink-0', met[i] ? 'opacity-100' : 'opacity-40')} />
                        {ruleLabels[r.key]()}
                    </li>
                ))}
            </ul>
        </div>
    );
}

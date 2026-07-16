import { cn } from '@/lib/cn';

// Thin labelled usage bar. `percent` 0-100; color shifts as it fills.
export function Meter({
    icon: Icon,
    label,
    value,
    percent,
}: {
    icon: typeof import('lucide-react').Cpu;
    label: string;
    value: string;
    percent: number | null;
}) {
    const p = percent === null ? null : Math.max(0, Math.min(100, percent));
    const tone =
        p === null
            ? 'bg-[var(--color-ink-faint)]'
            : p >= 90
              ? 'bg-[var(--color-danger)]'
              : p >= 70
                ? 'bg-[var(--color-warning)]'
                : 'bg-[var(--brand)]';

    return (
        <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-[var(--color-ink-muted)]">
                    <Icon className="h-3.5 w-3.5" /> {label}
                </span>
                <span className="font-medium text-[var(--color-ink)]">{value}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-surface-2)]">
                <div
                    className={cn('h-full rounded-full transition-all duration-500', tone)}
                    style={{ width: `${p ?? 0}%` }}
                />
            </div>
        </div>
    );
}

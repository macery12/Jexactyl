// A labelled range input with its current value called out and the two ends
// named. Shared by the generation settings, which are the only place in the
// panel where a continuous value reads better than a number box.
export function SliderRow({
    label,
    display,
    min,
    max,
    step,
    value,
    onChange,
    lowLabel,
    highLabel,
}: {
    label: string;
    display: string;
    min: number;
    max: number;
    step: number;
    value: number;
    onChange: (value: number) => void;
    lowLabel: string;
    highLabel: string;
}) {
    return (
        <div>
            <div className="mb-1.5 flex items-center justify-between">
                <span className="text-sm font-medium text-[var(--color-ink-muted)]">{label}</span>
                <span className="font-mono text-xs text-[var(--brand)]">{display}</span>
            </div>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={event => onChange(Number(event.target.value))}
                className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[var(--color-surface-2)]"
                style={{ accentColor: 'var(--brand)' }}
                aria-label={label}
            />
            <div className="mt-1 flex justify-between text-xs text-[var(--color-ink-faint)]">
                <span>{lowLabel}</span>
                <span>{highLabel}</span>
            </div>
        </div>
    );
}

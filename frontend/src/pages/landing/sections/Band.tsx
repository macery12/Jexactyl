import { cn } from '@/lib/cn';

export type BandTone = 'base' | 'raised';

interface Props {
    tone: BandTone;
    children: React.ReactNode;
    className?: string;
}

// Full-bleed section wrapper: the background stretches edge-to-edge so the page
// reads as horizontal bands (no empty side gutters), while the content stays in a
// centered, readable column. `raised` bands get a subtle surface fill + hairline
// borders so adjacent sections alternate visually.
export default function Band({ tone, children, className }: Props) {
    return (
        <section
            className={cn(
                'w-full',
                tone === 'raised' && 'border-y border-[var(--color-border)] bg-[var(--color-surface)]/30',
            )}
        >
            <div className={cn('mx-auto max-w-6xl px-6 py-16 sm:py-20', className)}>{children}</div>
        </section>
    );
}

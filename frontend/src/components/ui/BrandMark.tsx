import logoIcon from '@/assets/logo-icon.png';
import { cn } from '@/lib/cn';

// The M12Labs cloud/server mark (icon-only cut of logo.png, transparent bg)
// next to the operator-configured site name. Replaces the old placeholder
// colored square in the top nav, landing header and auth card.
export function BrandMark({
    name,
    size = 'md',
    className,
}: {
    name: string;
    size?: 'md' | 'lg';
    className?: string;
}) {
    return (
        <span className={cn('flex items-center gap-2', className)}>
            <img
                src={logoIcon}
                alt=""
                className={cn('object-contain', size === 'lg' ? 'h-8 w-8' : 'h-7 w-7')}
            />
            <span
                className={cn(
                    'font-semibold tracking-tight text-[var(--color-ink)]',
                    size === 'lg' ? 'text-lg' : 'text-base',
                )}
            >
                {name}
            </span>
        </span>
    );
}

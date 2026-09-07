import logoIcon from '@/assets/logo-icon.png';
import { cn } from '@/lib/cn';

// The operator-configured logo next to the site name, with the bundled M12Labs
// mark as a safe default for blank or broken URLs.
export function BrandMark({
    name,
    logo,
    size = 'md',
    className,
}: {
    name: string;
    logo?: string | null;
    size?: 'md' | 'lg';
    className?: string;
}) {
    const configuredLogo = logo?.trim();

    return (
        <span className={cn('flex items-center gap-2', className)}>
            <img
                src={configuredLogo || logoIcon}
                alt=""
                width={32}
                height={32}
                className={cn('object-contain', size === 'lg' ? 'h-8 w-8' : 'h-7 w-7')}
                onError={event => {
                    // A broken operator-provided URL should not leave an empty
                    // brand mark. Avoid another error loop when the bundled
                    // fallback itself is the current source.
                    if (event.currentTarget.getAttribute('src') !== logoIcon) {
                        event.currentTarget.src = logoIcon;
                    }
                }}
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

import { useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { m } from '@/i18n';
import { getVisibleLinks } from '@/api/links';

// Operator-defined external links, pinned below the nav in the user sidebar
// (V1 parity: DashboardRouter rendered these at the bottom of its sidebar).
// The client endpoint only returns links marked visible, so everything here is
// meant to be seen. Renders nothing when there are none — most panels configure
// zero links, and an empty header would be noise.
export function CustomLinks() {
    const { data: links } = useQuery({
        queryKey: ['links', 'visible'],
        queryFn: getVisibleLinks,
        // These change rarely and are operator-managed; don't refetch on every
        // sidebar mount.
        staleTime: 5 * 60 * 1000,
    });

    if (!links || links.length === 0) return null;

    return (
        <div className="flex flex-col gap-1 border-t border-[var(--color-border)] pt-4">
            <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wider text-[var(--color-ink-faint)]">
                {m['nav.links.title']()}
            </p>
            {links.map(link => (
                <a
                    key={link.id}
                    href={link.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                >
                    <ExternalLink className="h-[18px] w-[18px] shrink-0" />
                    <span className="truncate">{link.name}</span>
                </a>
            ))}
        </div>
    );
}

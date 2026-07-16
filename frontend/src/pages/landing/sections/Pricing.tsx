import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cpu, MemoryStick, HardDrive } from 'lucide-react';
import { m } from '@/i18n';
import { useFlags } from '@/state/flags';
import { getCatalog, type StorefrontCategory } from '@/api/storefront';
import type { LandingSectionData } from '@/lib/globals';
import Band, { type BandTone } from './Band';

interface Props {
    data: LandingSectionData;
    tone: BandTone;
}

// Formats a memory/disk value (stored in MB) as a compact GB/MB string.
function formatSize(mb: number): string {
    if (mb <= 0) return '∞';
    return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 === 0 ? 0 : 1)} GB` : `${mb} MB`;
}

// Pricing / product showcase. Fetches the public catalog on mount (only mounted
// when the section is enabled), renders gracefully empty on error. Each card
// links to login/register to purchase.
export default function Pricing({ data, tone }: Props) {
    const billing = useFlags(s => s.everest?.billing);
    const symbol = billing?.currency?.symbol ?? '$';
    const [categories, setCategories] = useState<StorefrontCategory[] | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let active = true;
        getCatalog()
            .then(cats => {
                if (!active) return;
                const filter = data.categoryIds ?? [];
                setCategories(filter.length ? cats.filter(c => filter.includes(c.id)) : cats);
            })
            .catch(() => active && setFailed(true));
        return () => {
            active = false;
        };
    }, [data.categoryIds]);

    if (failed) return null;

    const heading = data.heading?.trim() || m['landing.pricing.heading']();

    return (
        <Band tone={tone}>
            <h2 className="mb-8 text-center text-3xl font-bold tracking-tight">{heading}</h2>

            {categories === null ? (
                <div className="grid gap-4 sm:grid-cols-3">
                    {[0, 1, 2].map(i => (
                        <div key={i} className="h-64 animate-pulse rounded-2xl bg-[var(--color-surface-2)]" />
                    ))}
                </div>
            ) : (
                categories
                    .filter(c => c.products.length > 0)
                    .map(category => (
                        <div key={category.id} className="mb-10">
                            <h3 className="mb-4 text-lg font-semibold">{category.name}</h3>
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                {category.products.map(product => (
                                    <div
                                        key={product.id}
                                        className="flex flex-col rounded-2xl border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70 p-6 backdrop-blur"
                                    >
                                        <div className="text-base font-semibold">{product.name}</div>
                                        {product.description && (
                                            <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{product.description}</p>
                                        )}
                                        <div className="mt-4 flex items-baseline gap-2">
                                            <span className="text-2xl font-bold text-[var(--brand)]">
                                                {symbol}
                                                {product.price}
                                            </span>
                                            {product.base_price != null && product.base_price > product.price && (
                                                <span className="text-sm text-[var(--color-ink-muted)] line-through">
                                                    {symbol}
                                                    {product.base_price}
                                                </span>
                                            )}
                                        </div>
                                        <ul className="mt-4 space-y-1.5 text-sm text-[var(--color-ink-muted)]">
                                            <li className="flex items-center gap-2">
                                                <Cpu className="h-4 w-4 text-[var(--brand)]" /> {product.limits.cpu}%{' '}
                                                {m['landing.pricing.cpu']()}
                                            </li>
                                            <li className="flex items-center gap-2">
                                                <MemoryStick className="h-4 w-4 text-[var(--brand)]" />{' '}
                                                {formatSize(product.limits.memory)} {m['landing.pricing.ram']()}
                                            </li>
                                            <li className="flex items-center gap-2">
                                                <HardDrive className="h-4 w-4 text-[var(--brand)]" />{' '}
                                                {formatSize(product.limits.disk)} {m['landing.pricing.disk']()}
                                            </li>
                                        </ul>
                                        <Link
                                            to="/auth/login"
                                            className="mt-6 inline-flex h-10 items-center justify-center rounded-xl bg-[var(--brand)] px-5 text-sm font-semibold text-[var(--color-brand-ink)] hover:bg-[var(--brand-hover)]"
                                        >
                                            {m['landing.pricing.cta']()}
                                        </Link>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))
            )}
        </Band>
    );
}

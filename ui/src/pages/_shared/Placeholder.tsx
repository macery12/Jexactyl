import { m } from '@/i18n';
import { Link, useLocation } from 'react-router-dom';
import { ArrowLeft, Hammer } from 'lucide-react';
import { Button } from '@/components/ui/Button';

// The single "not built yet" page rendered for every route whose registry
// entry has no `element`. Shows title, breadcrumb and back-nav.
export default function Placeholder({ title }: { title?: string }) {
    const location = useLocation();
    const segments = location.pathname.split('/').filter(Boolean);
    const heading = title ?? segments[segments.length - 1] ?? 'Page';

    return (
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-24 text-center">
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-[var(--color-surface-2)] ring-1 ring-[var(--color-border-strong)]">
                <Hammer className="h-7 w-7 text-[var(--brand)]" />
            </div>

            <nav className="mb-2 text-xs uppercase tracking-widest text-[var(--color-ink-faint)]">
                {segments.length ? segments.join(' / ') : m['common.placeholder.home']()}
            </nav>

            <h1 className="text-2xl font-semibold capitalize text-[var(--color-ink)]">{heading}</h1>
            <p className="mt-2 max-w-md text-sm text-[var(--color-ink-muted)]">
                {m['common.placeholder.notBuilt']()}
            </p>

            <Button variant="outline" className="mt-8" onClick={() => window.history.back()}>
                <ArrowLeft className="h-4 w-4" /> {m['common.actions.back']()}
            </Button>

            <Link to="/" className="mt-3 text-sm text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]">
                {m['common.nav.returnToDashboard']()}
            </Link>
        </div>
    );
}

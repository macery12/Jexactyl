import { m } from '@/i18n';
import { Link } from 'react-router-dom';

export default function NotFound() {
    return (
        <div className="bg-aurora flex min-h-screen flex-col items-center justify-center px-6 text-center">
            <p className="text-6xl font-bold text-[var(--brand)]">{m['common.notFound.code']()}</p>
            <h1 className="mt-4 text-2xl font-semibold">{m['common.notFound.title']()}</h1>
            <p className="mt-2 text-sm text-[var(--color-ink-muted)]">
                {m['common.notFound.body']()}
            </p>
            <Link
                to="/"
                className="mt-8 inline-flex h-11 items-center rounded-xl bg-[var(--brand)] px-6 text-sm font-medium text-[var(--color-brand-ink)] hover:bg-[var(--brand-hover)]"
            >
                {m['common.notFound.back']()}
            </Link>
        </div>
    );
}

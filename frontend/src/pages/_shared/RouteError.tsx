import { AlertTriangle } from 'lucide-react';
import { Link, isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { m } from '@/i18n';
import { isStaleChunkError, attemptStaleChunkReload } from '@/lib/staleChunk';
import { Spinner } from '@/components/ui/Spinner';

// Route-level error boundary wired onto every top-level route (see App.tsx as
// `errorElement`). Without it, an uncaught render/loader error drops the user on
// react-router's bare default screen — the one that tells you to "provide your
// own ErrorBoundary or errorElement prop on your route". This renders the
// panel-styled fallback instead, surfaces the underlying error for support, and
// gives a way back out. Sibling of AccessDenied / FeatureDisabled / NotFound.
export default function RouteError() {
    const error = useRouteError();

    // A lazy chunk 404'd because a new build replaced the hashed assets (e.g.
    // an extension install ran pnpm build). Reload once to pick up the fresh
    // bundle instead of showing an error for a session that is perfectly fine;
    // if a reload was already attempted within the last minute (build still in
    // progress?), fall through to the normal error screen and its manual
    // Reload button. The vite:preloadError guard in main.tsx usually recovers
    // before the error ever reaches this boundary — this is the fallback.
    if (isStaleChunkError(error) && attemptStaleChunkReload()) {
        return (
            <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 py-16 text-center">
                <Spinner className="h-6 w-6" />
                <p className="text-sm text-[var(--color-ink-muted)]">{m['common.error.updating']()}</p>
            </div>
        );
    }

    const status = isRouteErrorResponse(error) ? error.status : undefined;
    const detail = isRouteErrorResponse(error)
        ? error.statusText || (typeof error.data === 'string' ? error.data : undefined)
        : error instanceof Error
          ? error.message
          : undefined;

    return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center px-6 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-[var(--color-danger)]/10 text-[var(--color-danger)]">
                <AlertTriangle className="h-6 w-6" />
            </div>
            <h1 className="mt-5 text-lg font-semibold text-[var(--color-ink)]">
                {m['common.error.title']()}
            </h1>
            <p className="mt-2 max-w-md text-sm text-[var(--color-ink-muted)]">
                {m['common.error.body']()}
            </p>
            {detail && (
                <p className="mt-4 max-w-lg break-words rounded-md bg-[var(--color-surface-2)] px-3 py-1.5 font-mono text-xs text-[var(--color-ink-muted)]">
                    {status ? `${status} · ` : ''}
                    {detail}
                </p>
            )}
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
                <button
                    type="button"
                    onClick={() => window.location.reload()}
                    className="inline-flex h-11 items-center rounded-lg bg-[var(--brand)] px-6 text-sm font-medium text-[var(--color-brand-ink)] hover:bg-[var(--brand-hover)]"
                >
                    {m['common.error.reload']()}
                </button>
                <Link
                    to="/"
                    className="inline-flex h-11 items-center rounded-lg border border-[var(--color-border)] px-6 text-sm font-medium text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]"
                >
                    {m['common.error.home']()}
                </Link>
            </div>
        </div>
    );
}

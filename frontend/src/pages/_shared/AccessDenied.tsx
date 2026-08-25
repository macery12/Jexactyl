import { Lock } from 'lucide-react';
import { m } from '@/i18n/messages';

// Shown when a route's `permission` gate rejects the current user. Sibling of
// FeatureDisabled: that one answers "is this module on?", this one answers "may
// you use it?". The nav already hides tabs you can't reach; this is the fallback
// for direct access (typed URL, stale bookmark, back button) so the panel says
// why instead of rendering a page whose every request 403s.
//
// Mirrors V1's AdminAccessDenied/PermissionRoute, including surfacing the
// required permission string — operators use it to tell a root admin exactly
// which grant they need.
export default function AccessDenied({ permission }: { permission?: string | string[] }) {
    const required = Array.isArray(permission) ? permission.join(' or ') : permission;

    return (
        <div className="flex min-h-[50vh] flex-col items-center justify-center px-6 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-[var(--color-danger)]/10 text-[var(--color-danger)]">
                <Lock className="h-6 w-6" />
            </div>
            <h1 className="mt-5 text-lg font-semibold text-[var(--color-ink)]">
                {m['common.accessDenied.title']()}
            </h1>
            <p className="mt-2 max-w-md text-sm text-[var(--color-ink-muted)]">
                {m['common.accessDenied.body']()}
            </p>
            {required && (
                <p className="mt-4 rounded-md bg-[var(--color-surface-2)] px-3 py-1.5 font-mono text-xs text-[var(--color-ink-muted)]">
                    {m['common.accessDenied.required']()}{' '}
                    <span className="text-[var(--color-ink)]">{required}</span>
                </p>
            )}
        </div>
    );
}

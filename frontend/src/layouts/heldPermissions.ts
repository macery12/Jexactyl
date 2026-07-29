import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/state/session';
import { getAdminPermissions } from '@/api/adminPermissions';

// Admin permission sourcing. Until 2026-07-15 this was a Phase 1 stub that
// handed `['*']` to anyone with an `admin_role_id`, which silently disabled
// every admin permission check in the app — the nav filter, the route gate and
// the ~15 pages that hide write controls behind `can()`. See
// docs/v1-cutover/01-audit-findings.md #11.
//
// Stable module-level constant: this array is returned as-is so consumers'
// `useMemo(..., [held])` stays referentially stable. Never build a fresh array
// per render here — an unstable snapshot is React #185 (infinite re-render).
const NO_HELD: string[] = [];

export interface AdminPermissions {
    /** Permission strings the current admin holds; `['*']` for root admins. */
    held: string[];
    /** True while the set is in flight — callers must not deny access yet. */
    isLoading: boolean;
}

/**
 * The current admin's held-permission set.
 *
 * Every administrator, including the protected Owner profile, resolves its
 * capabilities from the assigned access profile. `root_admin` is compatibility
 * display data and is intentionally not an authorization source in this UI.
 * Non-admins resolve to the empty set without a request.
 *
 * Fails **closed**: `held` is empty until the real set arrives, so a caller that
 * ignores `isLoading` hides controls rather than leaking them. Route gating must
 * honour `isLoading` and render a spinner, otherwise it flashes "Access Denied"
 * on first paint. Note this is the opposite default from `FeatureGate`, which
 * fails open on unloaded flags — an unknown flag means "probably on", an unknown
 * permission means "not yet proven".
 */
export function useAdminPermissions(): AdminPermissions {
    const roleAdmin = useSession(s => Boolean(s.user?.admin_role_id));

    const { data, isLoading } = useQuery({
        queryKey: ['admin', 'permissions'],
        queryFn: getAdminPermissions,
        // Only accounts with an assigned access profile have a set to fetch.
        enabled: roleAdmin,
        // The set only changes when an operator edits the role, which forces a
        // reload anyway — no need to re-fetch it per page.
        staleTime: Infinity,
    });

    if (!roleAdmin) return { held: NO_HELD, isLoading: false };
    return { held: data ?? NO_HELD, isLoading };
}

/**
 * Held permissions only — for callers gating rendering *within* an already
 * permitted page (hiding create/update/delete controls). Failing closed while
 * the set loads is the right default for a button.
 */
export function useAdminHeld(): string[] {
    return useAdminPermissions().held;
}

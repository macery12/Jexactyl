import http from '@/lib/http';

// The authenticated admin's held-permission set (Application API).
// Mirrors V1's `resources/scripts/plugins/useAdminPermissions.ts`. No backend
// changes: `GET /api/application/permissions` has been live all along — V1
// consumed it and V2 never did (see docs/v1-cutover/01-audit-findings.md #11).
//
// The endpoint sits behind `AuthenticateApplicationUser`, so it is only
// reachable by an account with an assigned access profile.

export async function getAdminPermissions(): Promise<string[]> {
    const { data } = await http.get('/api/application/permissions');
    const permissions = data?.attributes?.permissions;

    // AdminPermissionService builds its return as `$permissions[] = $role->permissions`,
    // so the set arrives wrapped one level deep ([['a.read', ...]]). Unwrap it.
    if (Array.isArray(permissions?.[0])) return permissions[0] as string[];
    return Array.isArray(permissions) ? (permissions as string[]) : [];
}

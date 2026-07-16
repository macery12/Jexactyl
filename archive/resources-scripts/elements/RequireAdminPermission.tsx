import type { ReactNode } from 'react';
import { useStoreState } from '@/state/hooks';
import Spinner from '@/elements/Spinner';
import AdminAccessDenied from '@/elements/AdminAccessDenied';
import AdminReadOnlyBanner from '@/elements/AdminReadOnlyBanner';
import { useAdminPermissions } from '@/plugins/useAdminPermissions';

interface Props {
    /** The permission string that must be present in the user's role (e.g. 'roles.read'). */
    permission: string;
    children: ReactNode;
}

/**
 * Returns true if the user has no write-level permissions for the given
 * permission group (e.g. 'roles' when permission is 'roles.read').
 * Groups with only a single 'read' key (e.g. 'overview', 'activity') are
 * never considered read-only — there's nothing to write.
 */
const WRITE_KEYS = ['create', 'update', 'delete', 'install', 'send', 'import', 'export', 'repositories'];

/** Groups that are inherently view-only — no write operations exist for them. */
const READ_ONLY_EXEMPT = new Set(['overview', 'activity']);

function isReadOnly(permission: string, permissions: string[]): boolean {
    // Wildcard means full access — not read-only.
    if (permissions.includes('*')) return false;

    const group = permission.split('.')[0];
    if (!group) return false;

    // These groups have no write operations at all — don't show the banner.
    if (READ_ONLY_EXEMPT.has(group)) return false;

    // Check if the user has any write-level permission in this group.
    const hasWrite = WRITE_KEYS.some(key => permissions.includes(`${group}.${key}`));
    return !hasWrite;
}

/**
 * Wraps an admin page and blocks access if the current user's role does not
 * include the required permission. Root admins always pass through.
 * Shows a read-only banner when the user can view but not modify.
 */
export default function RequireAdminPermission({ permission, children }: Props) {
    const rootAdmin = useStoreState(state => state.user.data?.rootAdmin ?? false);
    const { can, isLoading, permissions } = useAdminPermissions();

    // Root admins bypass all permission checks.
    if (rootAdmin) return <>{children}</>;

    // Show spinner while fetching the permission list.
    if (isLoading) return <Spinner size={'large'} centered />;

    // Block access if the user lacks the required permission.
    if (!can(permission)) return <AdminAccessDenied permission={permission} />;

    const readOnly = permissions ? isReadOnly(permission, permissions) : false;

    return (
        <>
            {readOnly && <AdminReadOnlyBanner />}
            {children}
        </>
    );
}

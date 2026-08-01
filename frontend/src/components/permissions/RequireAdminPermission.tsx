import type { ReactElement } from 'react';
import { can } from '@/lib/can';
import { useAdminPermissions } from '@/layouts/heldPermissions';
import AccessDenied from '@/pages/_shared/AccessDenied';
import { FullPageSpinner } from '@/components/ui/Spinner';

// Blocks an admin surface unless the current admin holds `permission`.
// Ported from V1's `elements/RequireAdminPermission.tsx`.
//
// Used two ways: by the router for whole registry routes, and directly by
// sections whose inner <Routes> own sub-pages that V1 gated separately (the egg
// editor's `eggs.read`) — those can't be expressed in the flat route registry.
//
// Fails CLOSED, which is why the loading state is not optional: `held` is empty
// until the real set lands, so skipping the spinner would deny a legitimate
// admin on first paint. Owner also resolves through its protected profile.
export function RequireAdminPermission({
    permission,
    children,
}: {
    permission?: string | string[];
    children: ReactElement;
}): ReactElement {
    const { held, isLoading } = useAdminPermissions();

    if (!permission) return children;
    if (isLoading) return <FullPageSpinner />;
    if (!can(held, permission)) return <AccessDenied permission={permission} />;
    return children;
}

export default RequireAdminPermission;

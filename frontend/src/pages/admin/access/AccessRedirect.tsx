import { Navigate, useParams } from 'react-router-dom';
import { can } from '@/lib/can';
import { useAdminPermissions } from '@/layouts/heldPermissions';
import { Spinner } from '@/components/ui/Spinner';
import AccessDenied from '@/pages/_shared/AccessDenied';

// Access Control is three sidebar entries under /admin/access/*. Everything that
// used to address the old standalone pages — or the tabbed section that briefly
// replaced them — lands here and is forwarded to the current path.
type LegacyAccessArea = 'users' | 'roles' | 'api' | 'people';

const targets: Record<LegacyAccessArea, string> = {
    users: 'users',
    people: 'users',
    roles: 'profiles',
    api: 'api-keys',
};

function redirect(area: LegacyAccessArea) {
    return function AccessRedirect() {
        const rest = useParams()['*'] ?? '';
        const suffix = rest ? `/${rest}` : '';
        return <Navigate to={`/admin/access/${targets[area]}${suffix}`} replace />;
    };
}

export const UsersAccessRedirect = redirect('users');
export const RolesAccessRedirect = redirect('roles');
export const ApiKeysAccessRedirect = redirect('api');
export const PeopleAccessRedirect = redirect('people');

const SECTIONS = [
    { to: '/admin/access/users', permission: 'users.read' },
    { to: '/admin/access/profiles', permission: 'roles.read' },
    { to: '/admin/access/api-keys', permission: 'api.read' },
] as const;

/** Bare /admin/access — opens the first section the viewer holds a permission for. */
export function AccessIndexRedirect() {
    const { held, isLoading } = useAdminPermissions();

    if (isLoading) {
        return (
            <div className="flex justify-center py-20">
                <Spinner className="h-6 w-6" />
            </div>
        );
    }

    const first = SECTIONS.find(section => can(held, section.permission));
    return first ? (
        <Navigate to={first.to} replace />
    ) : (
        <AccessDenied permission={SECTIONS.map(section => section.permission)} />
    );
}

export default AccessIndexRedirect;

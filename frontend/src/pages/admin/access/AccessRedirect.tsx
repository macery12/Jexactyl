import { Navigate, useParams } from 'react-router-dom';

type LegacyAccessArea = 'users' | 'roles' | 'api';

const targets: Record<LegacyAccessArea, string> = {
    users: 'people',
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

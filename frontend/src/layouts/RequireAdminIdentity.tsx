import { Navigate, useLocation } from 'react-router-dom';
import { useSession } from '@/state/session';
import AccessDenied from '@/pages/_shared/AccessDenied';

export function RequireAdminIdentity({ children }: { children: React.ReactNode }) {
    const user = useSession(s => s.user);
    const location = useLocation();

    if (!user) {
        return <Navigate to="/auth/login" replace state={{ from: location.pathname }} />;
    }

    if (!user.admin_role_id) {
        return <AccessDenied />;
    }

    return <>{children}</>;
}

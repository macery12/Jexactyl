import { Navigate, useLocation } from 'react-router-dom';
import { useSession } from '@/state/session';

// Auth guard: unauthenticated users hitting a protected area are sent to login.
export function RequireAuth({ children }: { children: React.ReactNode }) {
    const isAuthenticated = useSession(s => s.isAuthenticated);
    const location = useLocation();

    if (!isAuthenticated) {
        return <Navigate to="/auth/login" replace state={{ from: location.pathname }} />;
    }
    return <>{children}</>;
}

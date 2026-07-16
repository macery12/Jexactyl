import useSWR from 'swr';
import http from '@/api/http';
import { useStoreState } from '@/state/hooks';

const fetchAdminPermissions = async (): Promise<string[]> => {
    const { data } = await http.get('/api/application/permissions');
    // AdminPermissionService returns [[...]] (wrapped one level), flatten it.
    const perms = data?.attributes?.permissions;
    if (Array.isArray(perms?.[0])) return perms[0] as string[];
    return Array.isArray(perms) ? (perms as string[]) : [];
};

/**
 * Returns a `can(permission)` helper for checking whether the currently
 * authenticated admin has a specific permission string.
 *
 * Root admins always return true without hitting the API.
 */
export const useAdminPermissions = () => {
    const rootAdmin = useStoreState(state => state.user.data?.rootAdmin ?? false);

    // Pass null key to skip fetching for root admins.
    const { data: permissions, isLoading } = useSWR<string[]>(
        rootAdmin ? null : 'admin:user:permissions',
        fetchAdminPermissions,
        { revalidateOnFocus: false, revalidateOnReconnect: false },
    );

    const can = (permission: string): boolean => {
        if (rootAdmin) return true;
        if (!permissions) return false;
        if (permissions.includes('*')) return true;
        return permissions.includes(permission);
    };

    return { can, isLoading: rootAdmin ? false : isLoading, permissions };
};

export default useAdminPermissions;

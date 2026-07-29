import { KeyRound, ShieldCheck, UserCog, Users } from 'lucide-react';
import { Navigate, NavLink, Route, Routes } from 'react-router-dom';
import { RequireAdminPermission } from '@/components/permissions/RequireAdminPermission';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import { can } from '@/lib/can';
import { useAdminPermissions } from '@/layouts/heldPermissions';
import AccessDenied from '@/pages/_shared/AccessDenied';
import UsersListPage from '@/pages/admin/users/UsersListPage';
import RolesListPage from '@/pages/admin/roles/RolesListPage';
import RoleDetailPage from '@/pages/admin/roles/RoleDetailPage';
import ApiKeysListPage from '@/pages/admin/api/ApiKeysListPage';
import { m } from '@/i18n';

const ITEMS = [
    {
        path: 'people',
        to: '/admin/access/people',
        label: m['admin.access.people.title'],
        description: m['admin.access.nav.people'],
        icon: Users,
        permission: 'users.read',
    },
    {
        path: 'profiles',
        to: '/admin/access/profiles',
        label: m['admin.access.profiles.title'],
        description: m['admin.access.nav.profiles'],
        icon: UserCog,
        permission: 'roles.read',
    },
    {
        path: 'api-keys',
        to: '/admin/access/api-keys',
        label: m['admin.access.keys.title'],
        description: m['admin.access.nav.keys'],
        icon: KeyRound,
        permission: 'api.read',
    },
] as const;

function AccessIndex() {
    const { held, isLoading } = useAdminPermissions();

    if (isLoading) {
        return (
            <div className="flex justify-center py-20">
                <Spinner className="h-6 w-6" />
            </div>
        );
    }

    const first = ITEMS.find(item => can(held, item.permission));
    return first ? <Navigate to={first.to} replace /> : <AccessDenied permission={ITEMS.map(item => item.permission)} />;
}

function AccessNav() {
    const { held } = useAdminPermissions();
    const visible = ITEMS.filter(item => can(held, item.permission));

    return (
        <nav aria-label={m['admin.access.nav.aria']()} className="grid gap-2 md:grid-cols-3">
            {visible.map(item => (
                <NavLink
                    key={item.path}
                    to={item.to}
                    className={({ isActive }) =>
                        cn(
                            'group flex items-start gap-3 rounded-lg border px-4 py-3 transition-colors',
                            isActive
                                ? 'border-[var(--brand)]/50 bg-[var(--brand-soft)] text-[var(--color-ink)]'
                                : 'border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)]',
                        )
                    }
                >
                    <item.icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand)]" />
                    <span className="min-w-0">
                        <span className="block text-sm font-semibold">{item.label()}</span>
                        <span className="mt-0.5 block text-xs text-[var(--color-ink-faint)]">{item.description()}</span>
                    </span>
                </NavLink>
            ))}
        </nav>
    );
}

function guarded(permission: string, element: React.ReactElement) {
    return <RequireAdminPermission permission={permission}>{element}</RequireAdminPermission>;
}

export default function AccessSection() {
    return (
        <div className="flex flex-col gap-6">
            <header className="flex items-start gap-3">
                <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--brand)]/30 bg-[var(--brand-soft)] text-[var(--brand)]">
                    <ShieldCheck className="h-5 w-5" />
                </span>
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
                        {m['admin.access.title']()}
                    </h1>
                    <p className="mt-1 max-w-3xl text-sm text-[var(--color-ink-muted)]">
                        {m['admin.access.subtitle']()}
                    </p>
                </div>
            </header>

            <AccessNav />

            <Routes>
                <Route index element={<AccessIndex />} />
                <Route path="people" element={guarded('users.read', <UsersListPage />)} />
                <Route path="profiles" element={guarded('roles.read', <RolesListPage />)} />
                <Route path="profiles/:id" element={guarded('roles.read', <RoleDetailPage />)} />
                <Route path="api-keys" element={guarded('api.read', <ApiKeysListPage />)} />
                <Route path="*" element={<AccessIndex />} />
            </Routes>
        </div>
    );
}

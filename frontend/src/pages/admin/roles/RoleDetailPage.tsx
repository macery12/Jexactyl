import { m } from '@/i18n/messages';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, KeyRound, LockKeyhole, Search, Users } from 'lucide-react';
import { getAdminRole, getPermissionGroups, updateRole } from '@/api/adminRoles';
import { can } from '@/lib/can';
import { useAdminHeld } from '@/layouts/heldPermissions';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { Switch } from '@/components/ui/Switch';
import PermissionMatrix from './PermissionMatrix';

const CROSS_GROUP_DEPENDENCIES: Record<string, string[]> = {
    'allocations.read': ['nodes.read'],
    'allocations.create': ['allocations.read', 'nodes.read'],
    'allocations.delete': ['allocations.read', 'nodes.read'],
};

// Granting and revoking obey the same dependency rules whether one cell or a
// whole column is toggled — the matrix makes bulk toggles a primary action, and
// a column of `*.update` without the matching `*.read` is exactly the unreachable
// grant these rules exist to prevent.
function grant(next: Set<string>, perm: string, namespaceHasRead: (namespace: string) => boolean): void {
    const [namespace, action] = perm.split('.', 2);
    if (!namespace || !action) return;

    next.add(perm);
    if (action !== 'read' && namespaceHasRead(namespace)) next.add(`${namespace}.read`);
    CROSS_GROUP_DEPENDENCIES[perm]?.forEach(dependency => next.add(dependency));
}

function revoke(next: Set<string>, perm: string): void {
    const [namespace, action] = perm.split('.', 2);
    if (!namespace || !action) return;

    next.delete(perm);
    // Without the section's read capability, write-only grants are unreachable
    // through both the UI and most API resources.
    if (action === 'read') {
        [...next].forEach(id => {
            if (id.startsWith(`${namespace}.`)) next.delete(id);
        });
    }
    [...next].forEach(id => {
        if (CROSS_GROUP_DEPENDENCIES[id]?.includes(perm)) next.delete(id);
    });
}

// Where this profile is in use. Deleting is blocked while either count is
// non-zero, so the numbers are shown up front rather than only in the error.
function AssignmentsCard({ users, apiKeys }: { users: number; apiKeys: number }) {
    const stats = [
        { icon: Users, count: users, label: m['admin.access.profiles.assignedUsers']({ count: users }) },
        { icon: KeyRound, count: apiKeys, label: m['admin.access.profiles.assignedKeys']({ count: apiKeys }) },
    ];

    return (
        <div className="rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-5">
            <h2 className="text-sm font-semibold text-[var(--color-ink)]">
                {m['admin.access.profiles.assignments']()}
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {stats.map(stat => (
                    <div
                        key={stat.label}
                        className="flex items-center gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/50 px-3 py-2.5"
                    >
                        <stat.icon className="h-4 w-4 shrink-0 text-[var(--color-ink-faint)]" />
                        <span className="text-sm text-[var(--color-ink-muted)]">{stat.label}</span>
                    </div>
                ))}
            </div>
            <p className="mt-3 text-xs text-[var(--color-ink-faint)]">
                {users + apiKeys > 0
                    ? m['admin.access.profiles.assignmentsInUse']()
                    : m['admin.access.profiles.assignmentsUnused']()}
            </p>
        </div>
    );
}

export default function RoleDetailPage() {
    const { id } = useParams<{ id: string }>();
    const roleId = Number(id);
    const navigate = useNavigate();
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();

    const held = useAdminHeld();
    const canUpdate = can(held, 'roles.update');
    const readOnly = !canUpdate;

    const roleQuery = useQuery({
        queryKey: ['admin', 'roles', roleId],
        queryFn: () => getAdminRole(roleId),
        enabled: Number.isFinite(roleId),
    });
    const permsQuery = useQuery({
        queryKey: ['admin', 'roles', 'permissions'],
        queryFn: getPermissionGroups,
    });

    const role = roleQuery.data;

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [color, setColor] = useState('#6366f1');
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [apiEligible, setApiEligible] = useState(false);
    const [permissionSearch, setPermissionSearch] = useState('');
    const [error, setError] = useState<string | null>(null);

    // Seed local edit state once the role loads (and whenever it is refetched
    // after a save).
    useEffect(() => {
        if (!role) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: syncs state to prop/query/filter changes
        setName(role.name);
        setDescription(role.description ?? '');
        setColor(role.color ?? '#6366f1');
        setSelected(new Set(role.permissions));
        setApiEligible(role.apiEligible);
    }, [role]);

    // The matrix always receives the full catalog so every namespace keeps its
    // shape; a search narrows which rows render and tints the matching cells.
    const matches = useMemo(() => {
        const query = permissionSearch.trim().toLowerCase();
        if (!query || !permsQuery.data) return null;

        const hits = new Set<string>();
        for (const [groupKey, group] of Object.entries(permsQuery.data)) {
            const groupMatches = `${groupKey} ${group.description}`.toLowerCase().includes(query);
            for (const [key, description] of Object.entries(group.keys)) {
                if (groupMatches || `${key} ${groupKey}.${key} ${description}`.toLowerCase().includes(query)) {
                    hits.add(`${groupKey}.${key}`);
                }
            }
        }
        return hits;
    }, [permissionSearch, permsQuery.data]);
    const allPermissions = useMemo(
        () => Object.entries(permsQuery.data ?? {}).flatMap(([group, details]) =>
            Object.keys(details.keys).map(key => `${group}.${key}`)
        ),
        [permsQuery.data],
    );

    const metaDirty =
        !!role &&
        (name !== role.name ||
            description !== (role.description ?? '') ||
            color !== (role.color ?? '#6366f1') ||
            apiEligible !== role.apiEligible);
    const permsDirty = useMemo(() => {
        if (!role) return false;
        const original = new Set(role.permissions);
        if (original.size !== selected.size) return true;
        for (const p of selected) if (!original.has(p)) return true;
        return false;
    }, [role, selected]);
    const dirty = metaDirty || permsDirty;

    const namespaceHasRead = (namespace: string) => Boolean(permsQuery.data?.[namespace]?.keys.read);

    const toggle = (perm: string) =>
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(perm)) revoke(next, perm);
            else grant(next, perm, namespaceHasRead);
            return next;
        });

    const toggleAll = (perms: string[], select: boolean) =>
        setSelected(prev => {
            const next = new Set(prev);
            perms.forEach(perm => (select ? grant(next, perm, namespaceHasRead) : revoke(next, perm)));
            return next;
        });

    const save = useMutation({
        mutationFn: () =>
            updateRole(roleId, {
                name,
                description: description || null,
                color,
                apiEligible,
                permissions: [...selected],
            }),
        onSuccess: async () => {
            setError(null);
            push({ type: 'success', message: m['admin.access.profiles.saved']() });
            await qc.invalidateQueries({ queryKey: ['admin', 'roles'] });
        },
        onError: err => setError(firstError(err) ?? m['common.states.genericError']()),
    });

    const discard = () => {
        if (!role) return;
        setName(role.name);
        setDescription(role.description ?? '');
        setColor(role.color ?? '#6366f1');
        setSelected(new Set(role.permissions));
        setApiEligible(role.apiEligible);
        setError(null);
    };

    if (roleQuery.isLoading || permsQuery.isLoading) {
        return (
            <div className="flex justify-center py-20">
                <Spinner className="h-6 w-6" />
            </div>
        );
    }

    if (roleQuery.isError || !role) {
        return (
            <div className="flex flex-col gap-4">
                <BackLink onClick={() => navigate('/admin/access/profiles')} />
                <p className="py-10 text-center text-sm text-[var(--color-danger)]">{m['admin.roles.loadError']()}</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-6 pb-24">
            <BackLink onClick={() => navigate('/admin/access/profiles')} />

            <header className="flex items-center gap-3">
                <span
                    className="h-4 w-4 shrink-0 rounded-full ring-1 ring-inset ring-black/10"
                    style={{ background: color || 'var(--color-ink-faint)' }}
                />
                <h1 className="text-xl font-semibold text-[var(--color-ink)]">{role.name}</h1>
                {role.isOwner && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--brand)]/30 bg-[var(--brand-soft)] px-2 py-1 text-xs font-semibold text-[var(--brand)]">
                        <LockKeyhole className="h-3.5 w-3.5" />
                        {m['admin.access.profiles.protectedOwner']()}
                    </span>
                )}
            </header>

            {error && (
                <p className="rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">
                    {error}
                </p>
            )}

            {/* Metadata */}
            <div className="rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-5">
                <h2 className="mb-4 text-sm font-semibold text-[var(--color-ink)]">
                    {m['admin.access.profiles.details']()}
                </h2>
                <div className="grid gap-4 md:grid-cols-2">
                    <Field label={m['admin.roles.form.name']()}>
                            <Input value={name} onChange={e => setName(e.target.value)} maxLength={64} disabled={readOnly || role.isSystem || role.isOwner} />
                    </Field>
                    <Field label={m['admin.roles.form.color']()}>
                        <div className="flex items-center gap-3">
                            <input
                                type="color"
                                value={color}
                                onChange={e => setColor(e.target.value)}
                                disabled={readOnly || role.isSystem || role.isOwner}
                                className="h-11 w-14 shrink-0 cursor-pointer rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] p-1 disabled:opacity-50"
                                aria-label={m['admin.roles.form.color']()}
                            />
                            <Input
                                value={color}
                                onChange={e => setColor(e.target.value)}
                                maxLength={9}
                                disabled={readOnly || role.isSystem || role.isOwner}
                                className="font-mono"
                            />
                        </div>
                    </Field>
                    <div className="md:col-span-2">
                        <Field label={m['admin.roles.form.description']()}>
                            <Input value={description} onChange={e => setDescription(e.target.value)} maxLength={255} disabled={readOnly || role.isSystem || role.isOwner} />
                        </Field>
                    </div>
                    <div className="md:col-span-2">
                        <label className="flex items-start gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-2)]/50 p-3">
                            <span className="min-w-0 flex-1">
                                <span className="block text-sm font-medium text-[var(--color-ink)]">
                                    {m['admin.access.profiles.apiAvailable']()}
                                </span>
                                <span className="mt-0.5 block text-xs text-[var(--color-ink-muted)]">
                                    {m['admin.access.profiles.apiDetailHint']()}
                                </span>
                            </span>
                            <Switch
                                checked={role.isOwner ? false : apiEligible}
                                onChange={setApiEligible}
                                disabled={readOnly || role.isSystem || role.isOwner}
                                className="mt-0.5"
                            />
                        </label>
                    </div>
                </div>
            </div>

            {role.assignedUsers !== null && role.assignedApiKeys !== null && (
                <AssignmentsCard users={role.assignedUsers} apiKeys={role.assignedApiKeys} />
            )}

            {/* Permission matrix */}
            <div className="flex flex-col gap-5">
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <h2 className="text-sm font-semibold text-[var(--color-ink)]">{m['admin.roles.permissionsHeading']()}</h2>
                        <p className="mt-1 text-xs text-[var(--color-ink-faint)]">
                            {m['admin.access.profiles.dependencyHint']()}
                        </p>
                        <p className="mt-1 text-xs font-medium text-[var(--color-ink-muted)]">
                            {m['admin.roles.capabilitySummary']({
                                selected: role.isOwner ? allPermissions.length : selected.size,
                                total: allPermissions.length,
                            })}
                        </p>
                    </div>
                    {!readOnly && !role.isSystem && !role.isOwner && (
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" onClick={() => setSelected(new Set(allPermissions))}>
                                {m['admin.roles.selectAll']()}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                                {m['admin.roles.deselectAll']()}
                            </Button>
                        </div>
                    )}
                </div>
                <div className="relative max-w-md">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
                    <Input
                        value={permissionSearch}
                        onChange={event => setPermissionSearch(event.target.value)}
                        placeholder={m['admin.roles.searchPermissions']()}
                        className="pl-9"
                    />
                </div>
                <PermissionMatrix
                    catalog={permsQuery.data ?? {}}
                    selected={selected}
                    matches={matches}
                    readOnly={readOnly || role.isSystem || role.isOwner}
                    onToggle={toggle}
                    onToggleAll={toggleAll}
                />
            </div>

            {/* Sticky save bar — only when the operator can edit and has changes. */}
            {!readOnly && !role.isSystem && !role.isOwner && dirty && (
                <div className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--color-border-strong)] bg-[var(--color-surface)]/95 backdrop-blur">
                    <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
                        <p className="text-sm text-[var(--color-ink-muted)]">{m['admin.roles.unsavedChanges']()}</p>
                        <div className="flex gap-2">
                            <Button variant="ghost" size="sm" onClick={discard} disabled={save.isPending}>
                                {m['common.actions.discard']()}
                            </Button>
                            <Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
                                {save.isPending && <Spinner className="h-4 w-4" />}
                                {m['common.actions.saveChanges']()}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function BackLink({ onClick }: { onClick: () => void }) {
    return (
        <button
            type="button"
            onClick={onClick}
            className="inline-flex w-fit items-center gap-1.5 text-sm text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
        >
            <ArrowLeft className="h-4 w-4" />
            {m['admin.access.profiles.back']()}
        </button>
    );
}

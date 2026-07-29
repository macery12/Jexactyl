import { m } from '@/i18n';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, LockKeyhole } from 'lucide-react';
import {
    getAdminRole,
    getPermissionGroups,
    updateRole,
    type AdminPermissionGroups,
} from '@/api/adminRoles';
import { can } from '@/lib/can';
import { useAdminHeld } from '@/layouts/heldPermissions';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { Switch } from '@/components/ui/Switch';

// Display grouping for the permission namespaces returned by the API. Any groups
// the API returns that aren't listed here are collected into a trailing "Other"
// section so nothing is ever hidden from operators.
const SECTIONS: { labelKey: string; keys: string[] }[] = [
    { labelKey: 'admin.roles.section.system', keys: ['overview', 'settings', 'activity', 'api', 'auth'] },
    { labelKey: 'admin.roles.section.communication', keys: ['email', 'webhooks', 'alerts', 'tickets', 'ai'] },
    {
        labelKey: 'admin.roles.section.infrastructure',
        keys: ['nodes', 'allocations', 'locations', 'databases', 'server-databases', 'mounts'],
    },
    { labelKey: 'admin.roles.section.content', keys: ['nests', 'eggs', 'extensions', 'mods'] },
    { labelKey: 'admin.roles.section.servers', keys: ['servers', 'server-presets'] },
    { labelKey: 'admin.roles.section.access', keys: ['users', 'roles'] },
    { labelKey: 'admin.roles.section.billing', keys: ['billing'] },
    { labelKey: 'admin.roles.section.customization', keys: ['theme', 'links', 'custom-domains'] },
];

function sectionLabel(key: string): string {
    switch (key) {
        case 'admin.roles.section.system':
            return m['admin.roles.section.system']();
        case 'admin.roles.section.communication':
            return m['admin.roles.section.communication']();
        case 'admin.roles.section.infrastructure':
            return m['admin.roles.section.infrastructure']();
        case 'admin.roles.section.content':
            return m['admin.roles.section.content']();
        case 'admin.roles.section.servers':
            return m['admin.roles.section.servers']();
        case 'admin.roles.section.access':
            return m['admin.roles.section.access']();
        case 'admin.roles.section.billing':
            return m['admin.roles.section.billing']();
        case 'admin.roles.section.customization':
            return m['admin.roles.section.customization']();
        default:
            return m['admin.roles.section.other']();
    }
}

// Title-cases a dotted/kebab permission fragment for display (e.g. "server-presets"
// -> "Server Presets"). These are backend-provided identifiers, not UI copy.
const humanize = (s: string) =>
    s
        .split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

interface DisplaySection {
    labelKey: string;
    groups: string[];
}

function buildSections(groups: AdminPermissionGroups): DisplaySection[] {
    const known = new Set(SECTIONS.flatMap(s => s.keys));
    const present = new Set(Object.keys(groups));
    const sections: DisplaySection[] = SECTIONS.map(s => ({
        labelKey: s.labelKey,
        groups: s.keys.filter(k => present.has(k)),
    })).filter(s => s.groups.length > 0);

    const leftover = Object.keys(groups).filter(k => !known.has(k));
    if (leftover.length) sections.push({ labelKey: 'admin.roles.section.other', groups: leftover });
    return sections;
}

function GroupCard({
    groupKey,
    group,
    selected,
    readOnly,
    onToggle,
    onToggleAll,
}: {
    groupKey: string;
    group: AdminPermissionGroups[string];
    selected: Set<string>;
    readOnly: boolean;
    onToggle: (perm: string) => void;
    onToggleAll: (perms: string[], select: boolean) => void;
}) {
    const permKeys = Object.keys(group.keys);
    const fullIds = permKeys.map(k => `${groupKey}.${k}`);
    const allSelected = fullIds.every(id => selected.has(id));
    const someSelected = fullIds.some(id => selected.has(id));

    return (
        <div className="flex flex-col rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)]">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-4 py-2.5">
                <span className="text-sm font-semibold text-[var(--color-ink)]">{humanize(groupKey)}</span>
                <button
                    type="button"
                    disabled={readOnly}
                    onClick={() => onToggleAll(fullIds, !allSelected)}
                    className={cn(
                        'rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-40',
                        allSelected
                            ? 'bg-[var(--brand)]/15 text-[var(--brand)]'
                            : someSelected
                              ? 'text-[var(--brand)] hover:bg-[var(--color-surface-2)]'
                              : 'text-[var(--color-ink-faint)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]',
                    )}
                >
                    {allSelected ? m['admin.roles.deselectAll']() : m['admin.roles.selectAll']()}
                </button>
            </div>
            {group.description && (
                <p className="px-4 pt-3 text-xs leading-snug text-[var(--color-ink-faint)]">{group.description}</p>
            )}
            <div className="flex flex-wrap gap-1.5 px-4 pb-4 pt-2.5">
                {permKeys.map(k => {
                    const id = `${groupKey}.${k}`;
                    const checked = selected.has(id);
                    return (
                        <button
                            key={id}
                            type="button"
                            disabled={readOnly}
                            title={group.keys[k]}
                            aria-pressed={checked}
                            onClick={() => onToggle(id)}
                            className={cn(
                                'inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                                checked
                                    ? 'border-[var(--brand)] bg-[var(--brand-soft)] text-[var(--brand)]'
                                    : 'border-[var(--color-border)] text-[var(--color-ink-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-ink)]',
                            )}
                        >
                            {checked && <Check className="h-3 w-3" />}
                            {humanize(k)}
                        </button>
                    );
                })}
            </div>
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

    const sections = useMemo(() => (permsQuery.data ? buildSections(permsQuery.data) : []), [permsQuery.data]);

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

    const toggle = (perm: string) =>
        setSelected(prev => {
            const next = new Set(prev);
            const [namespace, action] = perm.split('.', 2);
            if (!namespace || !action) return next;
            const readPermission = `${namespace}.read`;
            const namespaceHasRead = Boolean(permsQuery.data?.[namespace]?.keys.read);

            if (next.has(perm)) {
                next.delete(perm);
                // Without the section's read capability, write-only grants are
                // unreachable through both the UI and most API resources.
                if (action === 'read') {
                    [...next].forEach(id => {
                        if (id.startsWith(`${namespace}.`)) next.delete(id);
                    });
                }
            } else {
                next.add(perm);
                if (action !== 'read' && namespaceHasRead) next.add(readPermission);
            }
            return next;
        });

    const toggleAll = (perms: string[], select: boolean) =>
        setSelected(prev => {
            const next = new Set(prev);
            perms.forEach(p => (select ? next.add(p) : next.delete(p)));
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

            {/* Permission matrix */}
            <div className="flex flex-col gap-5">
                <div>
                    <h2 className="text-sm font-semibold text-[var(--color-ink)]">{m['admin.roles.permissionsHeading']()}</h2>
                    <p className="mt-1 text-xs text-[var(--color-ink-faint)]">
                        {m['admin.access.profiles.dependencyHint']()}
                    </p>
                </div>
                {sections.map(section => (
                    <section key={section.labelKey} className="flex flex-col gap-2.5">
                        <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-faint)]">
                            {sectionLabel(section.labelKey)}
                        </h3>
                        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                            {section.groups.map(groupKey => {
                                const group = permsQuery.data?.[groupKey];
                                if (!group) return null;
                                return (
                                    <GroupCard
                                        key={groupKey}
                                        groupKey={groupKey}
                                        group={group}
                                        selected={selected}
                                        readOnly={readOnly || role.isSystem || role.isOwner}
                                        onToggle={toggle}
                                        onToggleAll={toggleAll}
                                    />
                                );
                            })}
                        </div>
                    </section>
                ))}
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

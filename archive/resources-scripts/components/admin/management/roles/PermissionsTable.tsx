import { getRolePermisisons, updateRole } from '@/api/routes/admin/roles';
import type { AdminRolePermissions } from '@/api/routes/admin/roles';
import Spinner from '@/elements/Spinner';
import { useEffect, useState } from 'react';
import Checkbox from '@/elements/inputs/Checkbox';
import { Button } from '@/elements/button';
import { UserRole } from '@definitions/admin';
import SpinnerOverlay from '@/elements/SpinnerOverlay';
import { useStoreState } from '@/state/hooks';

/** Logical groupings displayed as collapsible sections. Keys must match the permission group names from the API. */
const SECTIONS: { label: string; keys: string[] }[] = [
    { label: 'System', keys: ['overview', 'settings', 'activity', 'api', 'auth'] },
    { label: 'Communication', keys: ['email', 'webhooks', 'alerts', 'tickets', 'ai'] },
    { label: 'Infrastructure', keys: ['nodes', 'databases', 'mounts'] },
    { label: 'Content & Extensions', keys: ['nests', 'eggs', 'extensions', 'mods'] },
    { label: 'Servers', keys: ['servers', 'server-presets'] },
    { label: 'Users & Access', keys: ['users', 'roles'] },
    { label: 'Billing', keys: ['billing'] },
    { label: 'Customization', keys: ['theme', 'links'] },
];

const formatLabel = (s: string) =>
    s
        .split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

interface GroupCardProps {
    groupKey: string;
    group: AdminRolePermissions[string];
    selected: string[];
    onToggle: (perm: string) => void;
    onToggleAll: (groupKey: string, allSelected: boolean) => void;
    colors: { primary: string; secondary: string; headers: string };
}

const GroupCard = ({ groupKey, group, selected, onToggle, onToggleAll, colors }: GroupCardProps) => {
    const permKeys = Object.keys(group.keys);
    const fullKeys = permKeys.map(pk => `${groupKey}.${pk}`);
    const allSelected = fullKeys.every(k => selected.includes(k));
    const someSelected = fullKeys.some(k => selected.includes(k));

    return (
        <div className={'rounded shadow-md flex flex-col'} style={{ backgroundColor: colors.secondary }}>
            {/* Card header */}
            <div
                className={'flex items-center justify-between px-4 py-2.5 rounded-t border-b border-black/40'}
                style={{ backgroundColor: colors.headers }}
            >
                <span className={'font-semibold text-sm text-neutral-100'}>{formatLabel(groupKey)}</span>
                <label
                    className={'flex items-center gap-1.5 cursor-pointer select-none'}
                    title={allSelected ? 'Deselect all' : 'Select all'}
                >
                    <span className={'text-xs text-neutral-400'}>All</span>
                    <Checkbox
                        checked={allSelected}
                        indeterminate={!allSelected && someSelected}
                        onChange={() => onToggleAll(groupKey, allSelected)}
                    />
                </label>
            </div>

            {/* Description */}
            <p className={'px-4 pt-3 pb-1 text-xs text-neutral-400 leading-snug'}>{group.description}</p>

            {/* Permission pills */}
            <div className={'px-4 pb-4 pt-2 flex flex-wrap gap-2'}>
                {permKeys.map(pk => {
                    const permId = `${groupKey}.${pk}`;
                    const isChecked = selected.includes(permId);
                    return (
                        <label
                            key={permId}
                            htmlFor={permId}
                            title={group.keys[pk]}
                            className={[
                                'flex items-center gap-1.5 px-2.5 py-1 rounded cursor-pointer select-none',
                                'border text-xs font-medium transition-colors duration-150',
                                isChecked
                                    ? 'border-transparent text-white'
                                    : 'border-neutral-600 text-neutral-400 hover:border-neutral-400 hover:text-neutral-200',
                            ].join(' ')}
                            style={
                                isChecked ? { backgroundColor: colors.primary, borderColor: colors.primary } : undefined
                            }
                        >
                            <Checkbox
                                id={permId}
                                checked={isChecked}
                                onChange={() => onToggle(permId)}
                                className={'hidden'}
                            />
                            {formatLabel(pk)}
                        </label>
                    );
                })}
            </div>
        </div>
    );
};

export default ({ role }: { role: UserRole }) => {
    const colors = useStoreState(state => state.theme.data!.colors);
    const [permissions, setPermissions] = useState<AdminRolePermissions>();
    const [selected, setSelected] = useState<string[]>(role.permissions ?? []);
    const [submitting, setSubmitting] = useState(false);
    const [saved, setSaved] = useState(false);

    const toggle = (perm: string) => {
        setSelected(prev => (prev.includes(perm) ? prev.filter(v => v !== perm) : [...prev, perm]));
        setSaved(false);
    };

    const toggleAll = (groupKey: string, allSelected: boolean) => {
        if (!permissions) return;
        const fullKeys = Object.keys(permissions[groupKey]?.keys ?? {}).map(pk => `${groupKey}.${pk}`);
        setSelected(prev =>
            allSelected
                ? prev.filter(v => !fullKeys.includes(v))
                : [...prev, ...fullKeys.filter(k => !prev.includes(k))],
        );
        setSaved(false);
    };

    const selectAll = () => {
        if (!permissions) return;
        const all = Object.entries(permissions).flatMap(([gk, g]) => Object.keys(g.keys).map(pk => `${gk}.${pk}`));
        setSelected(all);
        setSaved(false);
    };

    const clearAll = () => {
        setSelected([]);
        setSaved(false);
    };

    const save = () => {
        setSubmitting(true);
        updateRole(role.id, role.name, role.description, role.color, selected).then(() => {
            setSubmitting(false);
            setSaved(true);
        });
    };

    useEffect(() => {
        getRolePermisisons().then(data => setPermissions(data.attributes.permissions));
    }, []);

    if (!permissions) return <Spinner size={'large'} centered />;

    // Build a set of known groups per section; collect any API keys not in a section into "Other"
    const knownKeys = SECTIONS.flatMap(s => s.keys);
    const remainingKeys = Object.keys(permissions).filter(k => !knownKeys.includes(k));
    const sections = remainingKeys.length > 0 ? [...SECTIONS, { label: 'Other', keys: remainingKeys }] : SECTIONS;

    const totalPerms = Object.values(permissions).reduce((acc, g) => acc + Object.keys(g.keys).length, 0);
    const totalSelected = selected.length;

    return (
        <div className={'relative'}>
            <SpinnerOverlay visible={submitting} />

            {/* Toolbar */}
            <div className={'flex items-center justify-between mb-5 flex-wrap gap-3'}>
                <p className={'text-sm text-neutral-400'}>
                    <span className={'text-neutral-200 font-semibold'}>{totalSelected}</span>
                    {' / '}
                    {totalPerms} permissions selected
                </p>
                <div className={'flex gap-2'}>
                    <Button size={Button.Sizes.Small} variant={Button.Variants.Secondary} onClick={clearAll}>
                        Clear All
                    </Button>
                    <Button size={Button.Sizes.Small} variant={Button.Variants.Secondary} onClick={selectAll}>
                        Select All
                    </Button>
                    <Button size={Button.Sizes.Small} onClick={save}>
                        {saved ? 'Saved ✓' : 'Save'}
                    </Button>
                </div>
            </div>

            {/* Sections */}
            {sections.map(section => {
                // Only render groups that actually exist in API response
                const presentGroups = section.keys.filter(k => k in permissions);
                if (presentGroups.length === 0) return null;
                return (
                    <div key={section.label} className={'mb-8'}>
                        <div className={'flex items-center gap-3 mb-3'}>
                            <h3 className={'text-sm font-semibold uppercase tracking-widest text-neutral-400'}>
                                {section.label}
                            </h3>
                            <div className={'flex-1 h-px bg-neutral-700'} />
                        </div>
                        <div className={'grid gap-3 sm:grid-cols-2 xl:grid-cols-3'}>
                            {presentGroups.map(gk => (
                                <GroupCard
                                    key={gk}
                                    groupKey={gk}
                                    group={permissions[gk]}
                                    selected={selected}
                                    onToggle={toggle}
                                    onToggleAll={toggleAll}
                                    colors={colors}
                                />
                            ))}
                        </div>
                    </div>
                );
            })}

            {/* Bottom save */}
            <div className={'mt-2 text-right'}>
                <Button onClick={save}>{saved ? 'Saved ✓' : 'Save Changes'}</Button>
            </div>
        </div>
    );
};

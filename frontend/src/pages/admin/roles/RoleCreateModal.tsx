import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { m } from '@/i18n/messages';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input, Field } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { Switch } from '@/components/ui/Switch';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { can } from '@/lib/can';
import { useAdminHeld } from '@/layouts/heldPermissions';
import { cn } from '@/lib/cn';
import { createRole, getPermissionGroups, type AdminPermissionGroups } from '@/api/adminRoles';

const DEFAULT_COLOR = '#6366f1';

// Starting points for a new profile. A blank profile means hand-ticking up to 96
// capabilities on the detail page, so each preset seeds a shape operators
// actually ask for. Every list is derived from the live catalog rather than
// hardcoded in full, so a new capability joins the relevant preset automatically.
type PresetId = 'blank' | 'readOnly' | 'support' | 'billing';

const PRESET_LABELS: Record<PresetId, () => string> = {
    blank: m['admin.access.profiles.preset.blank'],
    readOnly: m['admin.access.profiles.preset.readOnly'],
    support: m['admin.access.profiles.preset.support'],
    billing: m['admin.access.profiles.preset.billing'],
};

const PRESET_HINTS: Record<PresetId, () => string> = {
    blank: m['admin.access.profiles.preset.blankHint'],
    readOnly: m['admin.access.profiles.preset.readOnlyHint'],
    support: m['admin.access.profiles.preset.supportHint'],
    billing: m['admin.access.profiles.preset.billingHint'],
};

const SUPPORT_CAPABILITIES = [
    'overview.read',
    'activity.read',
    'users.read',
    'users.update',
    'servers.read',
    'servers.update',
    'server-databases.read',
    'nodes.read',
    'allocations.read',
    'tickets.read',
    'tickets.create',
    'tickets.update',
    'tickets.message',
];

/** Capabilities a preset would grant, before the actor's own ceiling is applied. */
function presetCapabilities(preset: PresetId, catalog: AdminPermissionGroups): string[] {
    const ids = Object.entries(catalog).flatMap(([group, details]) =>
        Object.keys(details.keys).map(key => `${group}.${key}`),
    );

    switch (preset) {
        case 'readOnly':
            return ids.filter(id => id.endsWith('.read'));
        case 'support':
            // Filtered through the catalog so a renamed capability drops out here
            // rather than failing validation on submit.
            return SUPPORT_CAPABILITIES.filter(id => ids.includes(id));
        case 'billing':
            // The whole billing namespace except the provider-credential wipe,
            // plus the read access the module's pages depend on.
            return ids.filter(
                id =>
                    (id.startsWith('billing.') && id !== 'billing.delete-keys')
                    || ['overview.read', 'activity.read', 'users.read'].includes(id),
            );
        default:
            return [];
    }
}

// Create dialog: metadata plus a starting capability set. The detail page the
// operator lands on right after creation is where the set gets refined.
export default function RoleCreateModal({ open, onClose }: { open: boolean; onClose: () => void }) {
    const push = useFlashes(s => s.push);
    const qc = useQueryClient();
    const navigate = useNavigate();
    const held = useAdminHeld();

    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [color, setColor] = useState(DEFAULT_COLOR);
    const [apiEligible, setApiEligible] = useState(false);
    const [preset, setPreset] = useState<PresetId>('blank');
    const [error, setError] = useState<string | null>(null);

    const { data: catalog } = useQuery({
        queryKey: ['admin', 'roles', 'permissions'],
        queryFn: getPermissionGroups,
        enabled: open,
    });

    // The API rejects granting anything the actor does not hold themselves, so a
    // preset is trimmed to the actor's own ceiling before it is ever submitted.
    const permissions = useMemo(
        () => presetCapabilities(preset, catalog ?? {}).filter(id => can(held, id)),
        [preset, catalog, held],
    );

    useEffect(() => {
        if (!open) return;
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: syncs state to prop/query/filter changes
        setName('');
        setDescription('');
        setColor(DEFAULT_COLOR);
        setApiEligible(false);
        setPreset('blank');
        setError(null);
    }, [open]);

    const mutation = useMutation({
        mutationFn: () => createRole({ name, description: description || null, color, apiEligible, permissions }),
        onSuccess: async role => {
            push({ type: 'success', message: m['admin.access.profiles.created']() });
            await qc.invalidateQueries({ queryKey: ['admin', 'roles'] });
            onClose();
            navigate(`/admin/access/profiles/${role.id}`);
        },
        onError: err => setError(firstError(err) ?? m['common.states.genericError']()),
    });

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={m['admin.access.profiles.createTitle']()}
            description={m['admin.access.profiles.createSubtitle']()}
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={mutation.isPending}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button size="sm" onClick={() => mutation.mutate()} disabled={!name.trim() || mutation.isPending}>
                        {mutation.isPending && <Spinner className="h-4 w-4" />}
                        {m['admin.access.profiles.create']()}
                    </Button>
                </>
            }
        >
            <div className="flex flex-col gap-4">
                {error && (
                    <p className="rounded-lg border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-3 py-2 text-sm text-[var(--color-danger)]">
                        {error}
                    </p>
                )}
                <Field label={m['admin.roles.form.name']()}>
                    <Input value={name} onChange={e => setName(e.target.value)} maxLength={64} autoComplete="off" />
                </Field>
                <Field label={m['admin.roles.form.description']()}>
                    <Input value={description} onChange={e => setDescription(e.target.value)} maxLength={255} autoComplete="off" />
                </Field>
                <Field label={m['admin.roles.form.color']()} hint={m['admin.roles.form.colorHint']()}>
                    <div className="flex items-center gap-3">
                        <input
                            type="color"
                            value={color}
                            onChange={e => setColor(e.target.value)}
                            className="h-11 w-14 shrink-0 cursor-pointer rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] p-1"
                            aria-label={m['admin.roles.form.color']()}
                        />
                        <Input value={color} onChange={e => setColor(e.target.value)} maxLength={9} className="font-mono" />
                    </div>
                </Field>
                <Field label={m['admin.access.profiles.preset.label']()} hint={m['admin.access.profiles.preset.hint']()}>
                    <div className="grid gap-2 sm:grid-cols-2">
                        {(Object.keys(PRESET_LABELS) as PresetId[]).map(id => {
                            const active = preset === id;
                            const count = presetCapabilities(id, catalog ?? {}).filter(p => can(held, p)).length;
                            return (
                                <button
                                    key={id}
                                    type="button"
                                    aria-pressed={active}
                                    onClick={() => setPreset(id)}
                                    className={cn(
                                        'flex flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors',
                                        active
                                            ? 'border-[var(--brand)]/60 bg-[var(--brand-soft)]'
                                            : 'border-[var(--color-border-strong)] bg-[var(--color-surface-2)]/50 hover:bg-[var(--color-surface-2)]',
                                    )}
                                >
                                    <span className="flex items-center justify-between gap-2">
                                        <span className="text-sm font-medium text-[var(--color-ink)]">
                                            {PRESET_LABELS[id]()}
                                        </span>
                                        {count > 0 && (
                                            <span className="shrink-0 text-[11px] tabular-nums text-[var(--color-ink-faint)]">
                                                {count}
                                            </span>
                                        )}
                                    </span>
                                    <span className="text-xs leading-snug text-[var(--color-ink-muted)]">
                                        {PRESET_HINTS[id]()}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </Field>

                <label className="flex items-start gap-3 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface-2)]/50 p-3">
                    <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-[var(--color-ink)]">
                            {m['admin.access.profiles.apiAvailable']()}
                        </span>
                        <span className="mt-0.5 block text-xs text-[var(--color-ink-muted)]">
                            {m['admin.access.profiles.apiAvailableHint']()}
                        </span>
                    </span>
                    <Switch checked={apiEligible} onChange={setApiEligible} className="mt-0.5" />
                </label>
            </div>
        </Modal>
    );
}

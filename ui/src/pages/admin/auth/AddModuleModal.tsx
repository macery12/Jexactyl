import { useState } from 'react';
import { abs } from '@/lib/base';
import type { LucideIcon } from 'lucide-react';
import { DoorOpen, ShieldHalf, MessageCircle, Globe, Sparkles, Plus } from 'lucide-react';
import { m, td } from '@/i18n';
import type { EverestConfiguration } from '@/lib/globals';
import { Modal } from '@/components/ui/Modal';
import { Spinner } from '@/components/ui/Spinner';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { toggleAuthModule, type AuthModuleName } from '@/api/adminAuth';

interface Definition {
    name: AuthModuleName;
    icon: LucideIcon;
    tint: string;
    title: string;
    description: string;
    recommended?: string;
}

// The full catalog; the page filters out anything already enabled before opening.
const DEFINITIONS: Definition[] = [
    {
        name: 'onboarding',
        icon: DoorOpen,
        tint: 'var(--color-accent)',
        title: 'admin.auth.modules.onboarding.title',
        description: 'admin.auth.modules.onboarding.description',
        recommended: 'admin.auth.modules.onboarding.recommended',
    },
    {
        name: 'jguard',
        icon: ShieldHalf,
        tint: 'var(--brand)',
        title: 'admin.auth.modules.jguard.title',
        description: 'admin.auth.modules.jguard.description',
    },
    {
        name: 'discord',
        icon: MessageCircle,
        tint: 'var(--brand)',
        title: 'admin.auth.modules.discord.title',
        description: 'admin.auth.modules.discord.description',
    },
    {
        name: 'google',
        icon: Globe,
        tint: 'var(--color-warning)',
        title: 'admin.auth.modules.google.title',
        description: 'admin.auth.modules.google.description',
    },
];

export function AddModuleModal({
    open,
    onClose,
    modules,
}: {
    open: boolean;
    onClose: () => void;
    modules: EverestConfiguration['auth']['modules'];
}) {
    const push = useFlashes(s => s.push);
    const [busy, setBusy] = useState<AuthModuleName | null>(null);

    const available = DEFINITIONS.filter(d => {
        const mod = modules[d.name] as { enabled?: boolean } | undefined;
        return !mod?.enabled;
    });

    const enable = async (name: AuthModuleName) => {
        setBusy(name);
        try {
            await toggleAuthModule('enable', name);
            // Re-read the everest bootstrap so the newly enabled card renders.
            window.location.assign(abs('/admin/auth'));
        } catch (err) {
            setBusy(null);
            push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() });
        }
    };

    return (
        <Modal
            open={open}
            onClose={onClose}
            title={m['admin.auth.add.title']()}
            description={m['admin.auth.add.subtitle']()}
            size="md"
        >
            {available.length === 0 ? (
                <p className="py-6 text-center text-sm text-[var(--color-ink-muted)]">{m['admin.auth.add.allEnabled']()}</p>
            ) : (
                <div className="flex flex-col gap-3">
                    {available.map(def => {
                        const Icon = def.icon;
                        const loading = busy === def.name;
                        return (
                            <div
                                key={def.name}
                                className="flex items-start gap-3.5 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface-2)]/40 p-4"
                            >
                                <span
                                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                                    style={{ backgroundColor: `color-mix(in srgb, ${def.tint} 14%, transparent)`, color: def.tint }}
                                >
                                    <Icon className="h-5 w-5" />
                                </span>
                                <div className="min-w-0 flex-1">
                                    <p className="text-sm font-semibold text-[var(--color-ink)]">{td(def.title)}</p>
                                    <p className="mt-0.5 text-xs text-[var(--color-ink-muted)]">{td(def.description)}</p>
                                    {def.recommended && (
                                        <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-[var(--color-warning)]/10 px-2.5 py-1.5 text-[11px] text-[var(--color-ink-muted)]">
                                            <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-[var(--color-warning)]" />
                                            {td(def.recommended)}
                                        </p>
                                    )}
                                </div>
                                <button
                                    type="button"
                                    disabled={loading}
                                    onClick={() => enable(def.name)}
                                    className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-[var(--brand)] px-3.5 text-sm font-medium text-[var(--color-brand-ink)] transition-colors hover:bg-[var(--brand-hover)] disabled:opacity-50"
                                >
                                    {loading ? <Spinner className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                                    {m['admin.auth.add.enable']()}
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </Modal>
    );
}

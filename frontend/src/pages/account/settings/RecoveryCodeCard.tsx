import { m } from '@/i18n';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Check, TriangleAlert } from 'lucide-react';
import { getRecoveryCodeStatus, regenerateRecoveryCode } from '@/api/recoveryCode';
import { firstError } from '@/lib/apiError';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { Input, Field } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { RecoveryCodeDisplay } from '@/components/auth/RecoveryCodeDisplay';
import { SettingsCard } from './SettingsCard';

// Offline recovery code section. The stored code is hashed and can never be shown
// again, so "reveal" regenerates: it re-auths with the password, mints a fresh code
// (invalidating the old one), and displays it exactly once.
export function RecoveryCodeCard() {
    const queryClient = useQueryClient();
    const [open, setOpen] = useState(false);

    const { data: status } = useQuery({
        queryKey: ['account', 'recovery-code', 'status'],
        queryFn: getRecoveryCodeStatus,
    });

    const badge = status?.seen ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-accent)]/10 px-2.5 py-1 text-xs font-medium text-[var(--color-accent)]">
            <Check className="h-3.5 w-3.5" />
            {m['account.recoveryCode.saved']()}
        </span>
    ) : (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-warning)]/10 px-2.5 py-1 text-xs font-medium text-[var(--color-warning)]">
            <TriangleAlert className="h-3.5 w-3.5" />
            {m['account.recoveryCode.notSaved']()}
        </span>
    );

    return (
        <SettingsCardShell badge={badge}>
            <div className="flex justify-end">
                <Button size="sm" onClick={() => setOpen(true)}>
                    {m['account.recoveryCode.reveal']()}
                </Button>
            </div>

            {open && (
                <RevealModal
                    onClose={() => setOpen(false)}
                    onGenerated={() => queryClient.invalidateQueries({ queryKey: ['account', 'recovery-code', 'status'] })}
                />
            )}
        </SettingsCardShell>
    );
}

// Small wrapper so the card header/title live in one place.
function SettingsCardShell({ badge, children }: { badge: React.ReactNode; children: React.ReactNode }) {
    return (
        <SettingsCard
            title={m['account.recoveryCode.title']()}
            description={m['account.recoveryCode.description']()}
            icon={KeyRound}
            right={badge}
        >
            {children}
        </SettingsCard>
    );
}

function RevealModal({ onClose, onGenerated }: { onClose: () => void; onGenerated: () => void }) {
    const [password, setPassword] = useState('');
    const [code, setCode] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const regen = useMutation({
        mutationFn: () => regenerateRecoveryCode(password),
        onSuccess: value => {
            setCode(value);
            onGenerated();
        },
        onError: (err: unknown) => setError(firstError(err) ?? m['common.states.genericError']()),
    });

    // ---- Reveal step -------------------------------------------------------
    if (code) {
        return (
            <Modal
                open
                onClose={onClose}
                title={m['account.recoveryCode.modalRevealTitle']()}
                footer={
                    <Button size="sm" onClick={onClose}>
                        {m['account.recoveryCode.done']()}
                    </Button>
                }
            >
                <RecoveryCodeDisplay code={code} />
            </Modal>
        );
    }

    // ---- Password re-auth step --------------------------------------------
    return (
        <Modal
            open
            onClose={onClose}
            title={m['account.recoveryCode.modalConfirmTitle']()}
            description={m['account.recoveryCode.modalConfirmDescription']()}
            footer={
                <>
                    <Button variant="ghost" size="sm" onClick={onClose} disabled={regen.isPending}>
                        {m['common.actions.cancel']()}
                    </Button>
                    <Button
                        size="sm"
                        onClick={() => password.length > 0 && regen.mutate()}
                        disabled={password.length === 0 || regen.isPending}
                    >
                        {regen.isPending && <Spinner className="h-4 w-4" />}
                        {m['account.recoveryCode.generate']()}
                    </Button>
                </>
            }
        >
            <div className="flex items-start gap-2 rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3 py-2.5 text-sm text-[var(--color-ink)]">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warning)]" />
                <span>{m['account.recoveryCode.replaceWarning']()}</span>
            </div>
            <div className="mt-4">
                <Field label={m['account.recoveryCode.passwordLabel']()} htmlFor="rc-password" error={error ?? undefined}>
                    <Input
                        id="rc-password"
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        invalid={!!error}
                        onChange={e => {
                            setPassword(e.target.value);
                            setError(null);
                        }}
                    />
                </Field>
            </div>
        </Modal>
    );
}

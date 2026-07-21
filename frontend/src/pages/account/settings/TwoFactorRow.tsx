import { m } from '@/i18n';
import { useState } from 'react';
import { Smartphone, Check } from 'lucide-react';
import { useSession } from '@/state/session';
import { Button } from '@/components/ui/Button';
import { SettingsRow } from './SettingsRow';
import { TwoFactorSetupModal } from './TwoFactorSetupModal';
import { DisableTwoFactorModal } from './DisableTwoFactorModal';

export function TwoFactorRow() {
    const user = useSession(s => s.user);
    const setUser = useSession(s => s.setUser);
    const [setup, setSetup] = useState(false);
    const [disable, setDisable] = useState(false);

    const enabled = Boolean(user?.use_totp);

    const setUseTotp = (value: boolean) => {
        if (user) setUser({ ...user, use_totp: value });
    };

    const badge = enabled ? (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-accent)]/10 px-2.5 py-1 text-xs font-medium text-[var(--color-accent)]">
            <Check className="h-3.5 w-3.5" />
            {m['account.twoFactor.enabled']()}
        </span>
    ) : (
        <span className="text-xs text-[var(--color-ink-faint)]">{m['account.twoFactor.disabled']()}</span>
    );

    return (
        <SettingsRow
            icon={Smartphone}
            title={m['account.twoFactor.title']()}
            description={m['account.twoFactor.description']()}
            badge={badge}
            action={
                enabled ? (
                    <Button variant="outline" size="sm" onClick={() => setDisable(true)}>
                        {m['account.twoFactor.disable']()}
                    </Button>
                ) : (
                    <Button size="sm" onClick={() => setSetup(true)}>
                        {m['account.twoFactor.enable']()}
                    </Button>
                )
            }
        >
            {setup && (
                <TwoFactorSetupModal
                    open
                    onClose={() => setSetup(false)}
                    onEnabled={() => setUseTotp(true)}
                />
            )}
            {disable && (
                <DisableTwoFactorModal
                    open
                    onClose={() => setDisable(false)}
                    onDisabled={() => setUseTotp(false)}
                />
            )}
        </SettingsRow>
    );
}

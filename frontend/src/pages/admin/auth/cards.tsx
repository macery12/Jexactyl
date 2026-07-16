import { useState } from 'react';
import { abs } from '@/lib/base';
import { Link, useNavigate } from 'react-router-dom';
import { UserPlus, Lock, ShieldCheck, DoorOpen, ShieldHalf, MessageCircle, Globe, Info } from 'lucide-react';
import { m } from '@/i18n';
import type { EverestConfiguration } from '@/lib/globals';
import { Input, Field } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Switch } from '@/components/ui/Switch';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { ModuleCard, useModuleSave } from './ModuleCard';
import { toggleAuthModule, updateAuthModule, type AuthModuleName } from '@/api/adminAuth';

type Auth = EverestConfiguration['auth'];

// After enabling/disabling a module the everest bootstrap must be re-read, so we
// hard-navigate back to the section (same approach V1 used).
function reloadSection() {
    window.location.assign(abs('/admin/auth'));
}

// Shared destructive-remove control for the optional (SSO / onboarding) modules.
function useRemoveModule(name: AuthModuleName) {
    const [confirm, setConfirm] = useState(false);
    const [busy, setBusy] = useState(false);
    const dialog = (
        <ConfirmDialog
            open={confirm}
            onClose={() => setConfirm(false)}
            title={m['admin.auth.remove.title']()}
            body={m['admin.auth.remove.body']()}
            confirmLabel={m['common.actions.remove']()}
            cancelLabel={m['common.actions.cancel']()}
            busy={busy}
            onConfirm={async () => {
                setBusy(true);
                try {
                    await toggleAuthModule('disable', name);
                    reloadSection();
                } catch {
                    setBusy(false);
                    setConfirm(false);
                }
            }}
        />
    );
    return { open: () => setConfirm(true), dialog };
}

function HelpText({ children }: { children: React.ReactNode }) {
    return <p className="text-xs text-[var(--color-ink-faint)]">{children}</p>;
}

function CallbackHint({ url }: { url: string }) {
    return (
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)]/50 px-4 py-3">
            <p className="text-xs text-[var(--color-ink-muted)]">{m['admin.auth.sso.callback']()}</p>
            <code className="mt-1.5 block break-all rounded-lg bg-[var(--color-canvas)]/60 px-2.5 py-1.5 font-mono text-xs text-[var(--color-ink)]">
                {url}
            </code>
        </div>
    );
}

/* ── Registration ──────────────────────────────────────────────────────── */
export function RegistrationCard({ auth }: { auth: Auth }) {
    const { status, run } = useModuleSave();
    const [enabled, setEnabled] = useState(auth.registration.enabled);

    return (
        <ModuleCard icon={UserPlus} title={m['admin.auth.registration.title']()} status={status}>
            <label className="flex cursor-pointer items-start gap-3">
                <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-[var(--color-ink)]">
                        {m['admin.auth.registration.enabledLabel']()}
                    </span>
                    <HelpText>{m['admin.auth.registration.enabledHelp']()}</HelpText>
                </span>
                <Switch
                    checked={enabled}
                    onChange={next => {
                        setEnabled(next);
                        run(() => updateAuthModule('registration', 'enabled', next));
                    }}
                    className="mt-0.5"
                />
            </label>
        </ModuleCard>
    );
}

/* ── Security ──────────────────────────────────────────────────────────── */
export function SecurityCard({ auth }: { auth: Auth }) {
    const { status, run } = useModuleSave();
    const navigate = useNavigate();
    const [force2fa, setForce2fa] = useState(auth.security.force2fa);
    // Enabling force-2FA is a self-lockout risk: once on, an admin can't turn it
    // back off until their own account has 2FA. So require the current admin to
    // already have TOTP, and confirm before flipping it on.
    const adminHasTotp = Boolean(window.PterodactylUser?.use_totp);
    const [confirmForce, setConfirmForce] = useState(false);
    const [blocked, setBlocked] = useState(false);

    const applyForce2fa = (next: boolean) => {
        setForce2fa(next);
        run(() => updateAuthModule('security', 'force2fa', next));
    };

    const onToggleForce2fa = (next: boolean) => {
        if (!next) {
            applyForce2fa(false); // disabling is always safe
            return;
        }
        if (!adminHasTotp) {
            setBlocked(true); // can't enable until you have 2FA yourself
            return;
        }
        setConfirmForce(true);
    };

    return (
        <ModuleCard icon={Lock} title={m['admin.auth.security.title']()} status={status}>
            <ConfirmDialog
                open={confirmForce}
                onClose={() => setConfirmForce(false)}
                title={m['admin.auth.security.force2faConfirmTitle']()}
                body={m['admin.auth.security.force2faConfirmBody']()}
                confirmLabel={m['admin.auth.security.force2faConfirmAction']()}
                cancelLabel={m['common.actions.cancel']()}
                danger={false}
                onConfirm={() => {
                    setConfirmForce(false);
                    applyForce2fa(true);
                }}
            />
            <ConfirmDialog
                open={blocked}
                onClose={() => setBlocked(false)}
                title={m['admin.auth.security.force2faBlockedTitle']()}
                body={m['admin.auth.security.force2faBlockedBody']()}
                confirmLabel={m['admin.auth.security.force2faBlockedCta']()}
                cancelLabel={m['common.actions.cancel']()}
                danger={false}
                onConfirm={() => {
                    setBlocked(false);
                    navigate('/account/settings');
                }}
            />
            <label className="flex cursor-pointer items-start gap-3">
                <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium text-[var(--color-ink)]">
                        {m['admin.auth.security.force2faLabel']()}
                    </span>
                    <HelpText>{m['admin.auth.security.force2faHelp']()}</HelpText>
                </span>
                <Switch checked={force2fa} onChange={onToggleForce2fa} className="mt-0.5" />
            </label>
            <Field label={m['admin.auth.security.attemptsLabel']()} htmlFor="auth-attempts">
                <Input
                    id="auth-attempts"
                    type="number"
                    min={1}
                    defaultValue={auth.security.attempts ?? 3}
                    onBlur={e => run(() => updateAuthModule('security', 'attempts', Number(e.target.value) || 3))}
                />
                <HelpText>{m['admin.auth.security.attemptsHelp']()}</HelpText>
            </Field>
        </ModuleCard>
    );
}

/* ── Captcha ───────────────────────────────────────────────────────────── */
export function CaptchaCard({ auth }: { auth: Auth }) {
    const { status, run } = useModuleSave();
    const [provider, setProvider] = useState(auth.captcha.provider || 'disabled');

    return (
        <ModuleCard icon={ShieldCheck} title={m['admin.auth.captcha.title']()} status={status}>
            <Field label={m['admin.auth.captcha.providerLabel']()} htmlFor="captcha-provider">
                <Select
                    id="captcha-provider"
                    value={provider}
                    onChange={value => {
                        setProvider(value);
                        run(() => updateAuthModule('captcha', 'provider', value));
                    }}
                    options={[
                        { value: 'disabled', label: m['admin.auth.captcha.disabled']() },
                        { value: 'turnstile', label: m['admin.auth.captcha.turnstile']() },
                    ]}
                />
                <HelpText>{m['admin.auth.captcha.providerHelp']()}</HelpText>
            </Field>
            {provider === 'turnstile' && (
                <>
                    <Field label={m['admin.auth.captcha.siteKeyLabel']()} htmlFor="captcha-site-key">
                        <Input
                            id="captcha-site-key"
                            defaultValue={auth.captcha.site_key}
                            placeholder={m['admin.auth.captcha.siteKeyPlaceholder']()}
                            onBlur={e => run(() => updateAuthModule('captcha', 'site_key', e.target.value))}
                        />
                        <HelpText>{m['admin.auth.captcha.siteKeyHelp']()}</HelpText>
                    </Field>
                    <Field label={m['admin.auth.captcha.secretKeyLabel']()} htmlFor="captcha-secret-key">
                        <Input
                            id="captcha-secret-key"
                            type="password"
                            autoComplete="off"
                            placeholder={m['admin.auth.captcha.secretKeyPlaceholder']()}
                            onBlur={e =>
                                e.target.value && run(() => updateAuthModule('captcha', 'secret_key', e.target.value))
                            }
                        />
                        <HelpText>{m['admin.auth.captcha.secretKeyHelp']()}</HelpText>
                    </Field>
                </>
            )}
        </ModuleCard>
    );
}

/* ── Onboarding ────────────────────────────────────────────────────────── */
export function OnboardingCard({ auth }: { auth: Auth }) {
    const { status, run } = useModuleSave();
    const remove = useRemoveModule('onboarding');

    return (
        <ModuleCard
            icon={DoorOpen}
            title={m['admin.auth.onboarding.title']()}
            status={status}
            onRemove={remove.open}
            removeLabel={m['admin.auth.remove.title']()}
        >
            {remove.dialog}
            <Field label={m['admin.auth.onboarding.contentLabel']()} htmlFor="onboarding-content">
                <Input
                    id="onboarding-content"
                    defaultValue={auth.modules.onboarding.content ?? ''}
                    placeholder={m['admin.auth.onboarding.contentPlaceholder']()}
                    onBlur={e => run(() => updateAuthModule('onboarding', 'content', e.target.value))}
                />
                <HelpText>{m['admin.auth.onboarding.contentHelp']()}</HelpText>
            </Field>
            {auth.security.force2fa && (
                <div className="flex items-start gap-2.5 rounded-xl border border-[var(--brand)]/25 bg-[var(--brand)]/8 px-4 py-3">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand)]" />
                    <p className="text-xs text-[var(--color-ink-muted)]">{m['admin.auth.onboarding.force2faNote']()}</p>
                </div>
            )}
        </ModuleCard>
    );
}

/* ── jGuard summary ────────────────────────────────────────────────────── */
export function JGuardCard() {
    return (
        <ModuleCard icon={ShieldHalf} title={m['admin.auth.jguardCard.title']()}>
            <div className="flex items-start gap-2.5 rounded-xl border border-[var(--brand)]/25 bg-[var(--brand)]/8 px-4 py-3">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand)]" />
                <p className="text-xs text-[var(--color-ink-muted)]">{m['admin.auth.jguardCard.body']()}</p>
            </div>
            <Link to="/admin/auth/jguard" className="mt-auto">
                <Button variant="outline" size="sm" className="w-full">
                    {m['admin.auth.jguardCard.configure']()}
                </Button>
            </Link>
        </ModuleCard>
    );
}

/* ── SSO (Discord / Google) ────────────────────────────────────────────── */
function SsoCard({
    name,
    icon,
    title,
    settings,
    callback,
}: {
    name: AuthModuleName;
    icon: typeof MessageCircle;
    title: string;
    settings: { clientId?: boolean; clientSecret?: boolean };
    callback: string;
}) {
    const { status, run } = useModuleSave();
    const remove = useRemoveModule(name);

    return (
        <ModuleCard
            icon={icon}
            title={title}
            status={status}
            onRemove={remove.open}
            removeLabel={m['admin.auth.remove.title']()}
        >
            {remove.dialog}
            <Field label={m['admin.auth.sso.clientIdLabel']()} htmlFor={`${name}-client-id`}>
                <Input
                    id={`${name}-client-id`}
                    type="password"
                    autoComplete="off"
                    placeholder={settings.clientId ? '••••••••••••••••' : m['admin.auth.sso.clientIdPlaceholder']()}
                    onBlur={e => e.target.value && run(() => updateAuthModule(name, 'client_id', e.target.value))}
                />
                {!settings.clientId && <HelpText>{m['admin.auth.sso.required']()}</HelpText>}
            </Field>
            <Field label={m['admin.auth.sso.clientSecretLabel']()} htmlFor={`${name}-client-secret`}>
                <Input
                    id={`${name}-client-secret`}
                    type="password"
                    autoComplete="off"
                    placeholder={
                        settings.clientSecret ? '••••••••••••••••' : m['admin.auth.sso.clientSecretPlaceholder']()
                    }
                    onBlur={e => e.target.value && run(() => updateAuthModule(name, 'client_secret', e.target.value))}
                />
                {!settings.clientSecret && <HelpText>{m['admin.auth.sso.required']()}</HelpText>}
            </Field>
            <CallbackHint url={callback} />
        </ModuleCard>
    );
}

export function DiscordCard({ auth }: { auth: Auth }) {
    return (
        <SsoCard
            name="discord"
            icon={MessageCircle}
            title={m['admin.auth.discord.title']()}
            settings={auth.modules.discord}
            callback="/auth/modules/discord/authenticate"
        />
    );
}

export function GoogleCard({ auth }: { auth: Auth }) {
    return (
        <SsoCard
            name="google"
            icon={Globe}
            title={m['admin.auth.google.title']()}
            settings={auth.modules.google}
            callback="/auth/modules/google/authenticate"
        />
    );
}

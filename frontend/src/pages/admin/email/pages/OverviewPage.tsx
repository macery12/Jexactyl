import { m } from '@/i18n';
import { useEffect, useMemo, useState } from 'react';
import { Server, Plug } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/Switch';
import { FullPageSpinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';
import type { EmailTransport } from '@/api/email';
import { useEmailSettings } from '../useEmailSettings';
import { SettingsCard, SaveBar, LabeledField, TonePill } from '../parts';

interface Sender {
    fromName: string;
    fromEmail: string;
    replyTo: string;
}

// Overview: the at-a-glance delivery controls — master enable toggle, active
// transport, and the global sender identity. SMTP/Resend credentials live on
// their own rail pages.
export default function OverviewPage() {
    const { settings, isLoading, save, saving } = useEmailSettings();

    const [transport, setTransport] = useState<EmailTransport>('smtp');
    const [sender, setSender] = useState<Sender>({ fromName: '', fromEmail: '', replyTo: '' });
    const [togglingEnabled, setTogglingEnabled] = useState(false);

    const initial = useMemo<{ transport: EmailTransport; sender: Sender } | null>(() => {
        if (!settings) return null;
        const active = settings.transport === 'smtp' ? settings.smtp : settings.resend;
        return {
            transport: settings.transport,
            sender: {
                fromName: active.from_name || settings.smtp.from_name || settings.resend.from_name || '',
                fromEmail: active.from_email || settings.smtp.from_email || settings.resend.from_email || '',
                replyTo: active.reply_to || settings.smtp.reply_to || settings.resend.reply_to || '',
            },
        };
    }, [settings]);

    useEffect(() => {
        if (initial) {
            setTransport(initial.transport);
            setSender(initial.sender);
        }
    }, [initial]);

    const dirty = useMemo(() => {
        if (!initial) return false;
        return (
            transport !== initial.transport ||
            sender.fromName !== initial.sender.fromName ||
            sender.fromEmail !== initial.sender.fromEmail ||
            sender.replyTo !== initial.sender.replyTo
        );
    }, [initial, transport, sender]);

    if (isLoading || !settings) return <FullPageSpinner />;

    const smtpConfigured = Boolean(settings.smtp.host && settings.smtp.port && settings.smtp.from_email);
    const resendConfigured = Boolean(settings.resend.api_key && settings.resend.from_email);
    const activeConfigured = transport === 'smtp' ? smtpConfigured : resendConfigured;

    const toggleEnabled = async (next: boolean) => {
        setTogglingEnabled(true);
        try {
            await save({ enabled: next });
        } finally {
            setTogglingEnabled(false);
        }
    };

    const onSave = () =>
        save({
            transport,
            from_email: sender.fromEmail,
            from_name: sender.fromName,
            reply_to: sender.replyTo,
        });

    const onDiscard = () => {
        if (initial) {
            setTransport(initial.transport);
            setSender(initial.sender);
        }
    };

    return (
        <div className="flex flex-col gap-5">
            <SettingsCard
                title={m['admin.email.overview.deliveryTitle']()}
                description={m['admin.email.overview.deliveryDesc']()}
                right={
                    <div className="flex items-center gap-3">
                        <TonePill tone={settings.enabled ? 'success' : 'warning'}>
                            {settings.enabled ? m['admin.email.overview.on']() : m['admin.email.overview.off']()}
                        </TonePill>
                        <Switch
                            checked={settings.enabled}
                            onChange={toggleEnabled}
                            disabled={togglingEnabled || saving}
                            label={m['admin.email.overview.deliveryTitle']()}
                        />
                    </div>
                }
            >
                <p className="text-xs text-[var(--color-ink-faint)]">{m['admin.email.overview.deliveryHint']()}</p>
            </SettingsCard>

            <SettingsCard title={m['admin.email.overview.transportTitle']()} description={m['admin.email.overview.transportDesc']()}>
                <div className="grid grid-cols-2 gap-3 sm:max-w-md">
                    <TransportTile
                        icon={Server}
                        label={m['admin.email.overview.smtp']()}
                        active={transport === 'smtp'}
                        configured={smtpConfigured}
                        configuredLabel={m['admin.email.overview.configured']()}
                        incompleteLabel={m['admin.email.overview.incomplete']()}
                        onClick={() => setTransport('smtp')}
                    />
                    <TransportTile
                        icon={Plug}
                        label={m['admin.email.overview.resend']()}
                        active={transport === 'resend'}
                        configured={resendConfigured}
                        configuredLabel={m['admin.email.overview.configured']()}
                        incompleteLabel={m['admin.email.overview.incomplete']()}
                        onClick={() => setTransport('resend')}
                    />
                </div>
                {!activeConfigured && (
                    <p className="mt-3 text-xs text-[var(--color-warning)]">{m['admin.email.overview.activeIncomplete']()}</p>
                )}
            </SettingsCard>

            <SettingsCard title={m['admin.email.overview.senderTitle']()} description={m['admin.email.overview.senderDesc']()}>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <LabeledField label={m['admin.email.overview.fromName']()}>
                        <Input
                            value={sender.fromName}
                            onChange={e => setSender(s => ({ ...s, fromName: e.target.value }))}
                            placeholder={m['admin.email.overview.fromNamePlaceholder']()}
                        />
                    </LabeledField>
                    <LabeledField label={m['admin.email.overview.fromEmail']()} required>
                        <Input
                            type="email"
                            value={sender.fromEmail}
                            onChange={e => setSender(s => ({ ...s, fromEmail: e.target.value }))}
                            placeholder={m['admin.email.overview.fromEmailPlaceholder']()}
                        />
                    </LabeledField>
                    <LabeledField label={m['admin.email.overview.replyTo']()} hint={m['admin.email.overview.replyToHint']()}>
                        <Input
                            type="email"
                            value={sender.replyTo}
                            onChange={e => setSender(s => ({ ...s, replyTo: e.target.value }))}
                            placeholder={m['admin.email.overview.replyToPlaceholder']()}
                        />
                    </LabeledField>
                </div>
            </SettingsCard>

            <SaveBar dirty={dirty} saving={saving} onDiscard={onDiscard} onSave={onSave} />
        </div>
    );
}

function TransportTile({
    icon: Icon,
    label,
    active,
    configured,
    configuredLabel,
    incompleteLabel,
    onClick,
}: {
    icon: typeof Server;
    label: string;
    active: boolean;
    configured: boolean;
    configuredLabel: string;
    incompleteLabel: string;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={cn(
                'flex flex-col items-start gap-2 rounded-xl border px-3 py-3 text-left transition-colors',
                active
                    ? 'border-[var(--brand)] bg-[var(--brand)]/10'
                    : 'border-[var(--color-border-strong)] hover:bg-[var(--color-surface-2)]',
            )}
        >
            <span className="flex items-center gap-2 text-sm font-semibold text-[var(--color-ink)]">
                <Icon className="h-4 w-4 text-[var(--color-ink-muted)]" />
                {label}
            </span>
            <TonePill tone={configured ? 'success' : 'warning'}>
                {configured ? configuredLabel : incompleteLabel}
            </TonePill>
        </button>
    );
}

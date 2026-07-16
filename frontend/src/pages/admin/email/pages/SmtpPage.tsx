import { m } from '@/i18n';
import { useEffect, useMemo, useState } from 'react';
import { FlaskConical } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Spinner, FullPageSpinner } from '@/components/ui/Spinner';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { testSmtpConnection, type EmailResponse } from '@/api/email';
import { useEmailSettings } from '../useEmailSettings';
import { SettingsCard, SaveBar, LabeledField, TonePill } from '../parts';
import { TestResultBanner } from './TestResultBanner';

interface SmtpForm {
    host: string;
    port: string;
    username: string;
    encryption: string;
}

// SMTP transport configuration: connection details, password management, and a
// connection check. Split out of the old combined settings page.
export default function SmtpPage() {
    const { settings, isLoading, save, saving } = useEmailSettings();
    const push = useFlashes(s => s.push);

    const [form, setForm] = useState<SmtpForm>({ host: '', port: '', username: '', encryption: '' });
    const [password, setPassword] = useState('');
    const [testing, setTesting] = useState(false);
    const [resetting, setResetting] = useState(false);
    const [result, setResult] = useState<EmailResponse | null>(null);

    const initial = useMemo<SmtpForm | null>(() => {
        if (!settings) return null;
        return {
            host: settings.smtp.host || '',
            port: (settings.smtp.port || '').toString(),
            username: settings.smtp.username || '',
            encryption: settings.smtp.encryption || '',
        };
    }, [settings]);

    useEffect(() => {
        if (initial) setForm(initial);
    }, [initial]);

    const dirty = useMemo(() => {
        if (!initial) return false;
        return (
            form.host !== initial.host ||
            form.port !== initial.port ||
            form.username !== initial.username ||
            form.encryption !== initial.encryption ||
            password.trim().length > 0
        );
    }, [initial, form, password]);

    if (isLoading || !settings) return <FullPageSpinner />;

    const active = settings.transport === 'smtp';
    const configured = Boolean(form.host && form.port && settings.smtp.from_email);

    const onSave = async () => {
        await save({
            smtp_host: form.host,
            smtp_port: form.port,
            smtp_username: form.username,
            smtp_encryption: form.encryption,
            ...(password.trim() ? { smtp_password: password.trim() } : {}),
        });
        setPassword('');
    };

    const onDiscard = () => {
        if (initial) setForm(initial);
        setPassword('');
    };

    const clearPassword = async () => {
        await save({ smtp_password: '', clear_smtp_password: true });
        setPassword('');
    };

    const resetSmtp = async () => {
        setResetting(true);
        try {
            await save({
                smtp_host: '',
                smtp_port: '',
                smtp_username: '',
                smtp_encryption: '',
                smtp_password: '',
                clear_smtp_password: true,
            });
            setPassword('');
        } finally {
            setResetting(false);
        }
    };

    const runTest = () => {
        setTesting(true);
        testSmtpConnection()
            .then(setResult)
            .catch(err => push({ type: 'error', message: firstError(err) ?? m['admin.email.test.failed']() }))
            .finally(() => setTesting(false));
    };

    const encryptionOptions = [
        { value: 'none', label: m['admin.email.smtp.encNone']() },
        { value: 'tls', label: 'TLS' },
        { value: 'ssl', label: 'SSL' },
    ];

    return (
        <div className="flex flex-col gap-5">
            <SettingsCard
                title={m['admin.email.smtp.title']()}
                description={m['admin.email.smtp.desc']()}
                right={
                    <TonePill tone={active ? 'success' : 'neutral'}>
                        {active ? m['admin.email.smtp.active']() : m['admin.email.smtp.inactive']()}
                    </TonePill>
                }
            >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <LabeledField label={m['admin.email.smtp.host']()}>
                        <Input
                            value={form.host}
                            onChange={e => setForm(f => ({ ...f, host: e.target.value }))}
                            placeholder="smtp.yourdomain.com"
                        />
                    </LabeledField>
                    <LabeledField label={m['admin.email.smtp.port']()}>
                        <Input
                            type="number"
                            value={form.port}
                            onChange={e => setForm(f => ({ ...f, port: e.target.value }))}
                            placeholder="587"
                        />
                    </LabeledField>
                    <LabeledField label={m['admin.email.smtp.username']()}>
                        <Input
                            value={form.username}
                            onChange={e => setForm(f => ({ ...f, username: e.target.value }))}
                            placeholder="user@yourdomain.com"
                        />
                    </LabeledField>
                    <LabeledField label={m['admin.email.smtp.encryption']()}>
                        <Select
                            value={form.encryption || 'none'}
                            onChange={v => setForm(f => ({ ...f, encryption: v === 'none' ? '' : v }))}
                            options={encryptionOptions}
                        />
                    </LabeledField>
                    <LabeledField
                        label={m['admin.email.smtp.password']()}
                        hint={m['admin.email.smtp.passwordHint']()}
                    >
                        <Input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder={
                                settings.smtp.password_set
                                    ? m['admin.email.smtp.passwordSaved']()
                                    : m['admin.email.smtp.passwordEnter']()
                            }
                        />
                    </LabeledField>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={clearPassword}
                        disabled={!settings.smtp.password_set || saving}
                    >
                        {m['admin.email.smtp.clearPassword']()}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={resetSmtp} disabled={resetting || saving}>
                        {m['admin.email.smtp.reset']()}
                    </Button>
                </div>
            </SettingsCard>

            <SettingsCard
                title={m['admin.email.smtp.checkTitle']()}
                description={m['admin.email.smtp.checkDesc']()}
                right={
                    <Button variant="secondary" size="sm" onClick={runTest} disabled={testing}>
                        {testing ? <Spinner className="h-4 w-4" /> : <FlaskConical className="h-4 w-4" />}
                        {m['admin.email.smtp.checkButton']()}
                    </Button>
                }
            >
                <p className="text-xs text-[var(--color-ink-faint)]">
                    {m['admin.email.smtp.configuredState']({ state: configured ? m['admin.email.overview.configured']() : m['admin.email.overview.incomplete']() })}
                </p>
                {result && <TestResultBanner result={result} />}
            </SettingsCard>

            <SaveBar dirty={dirty} saving={saving} onDiscard={onDiscard} onSave={onSave} />
        </div>
    );
}

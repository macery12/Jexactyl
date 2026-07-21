import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEnvelope, faPaperPlane, faPlug, faServer, faVial } from '@fortawesome/free-solid-svg-icons';
import type { IconProp } from '@fortawesome/fontawesome-svg-core';
import AdminBox from '@/elements/AdminBox';
import Label from '@/elements/Label';
import Input from '@/elements/Input';
import { Button } from '@/elements/button';
import Pill from '@/elements/Pill';
import useFlash from '@/plugins/useFlash';
import useStatus from '@/plugins/useStatus';
import { useStoreState } from '@/state/hooks';
import {
    type EmailResponse,
    EmailSettings,
    EmailSettingsUpdate,
    type EmailStatus,
    EmailTransport,
    ResendPlanDefinition,
    ResendPlanKey,
    ResendQuotaUsage,
    getSettings,
    sendTestEmail,
    testResendConnection,
    testSmtpConnection,
    updateSettings,
} from '@/api/routes/admin/email';
import { getEmailStatusPresentation } from './status';
import {
    formatTestFlowDate,
    getConnectionCheckButtonLabel,
    getConnectionCheckSuccessMessage,
    getDeliveryTestDescription,
    getDeliveryTestSuccessMessage,
    getEmailResponseTimestamp,
} from './testFlow';

type TabKey = 'overview' | 'smtp' | 'resend' | 'testing';

type TestResult = {
    status: EmailStatus;
    transport: EmailTransport;
    message: string;
    tested_at: string;
    code?: string;
};

export default () => {
    const { status, setStatus } = useStatus();
    const { clearFlashes, addFlash, clearAndAddHttpError } = useFlash();
    const { primary, secondary, headers } = useStoreState(state => state.theme.data!.colors);

    const resolveEmailResponseStatus = (response: EmailResponse): EmailStatus =>
        response.status || (response.success ? 'sent' : 'failed');

    const getFlashType = (status: EmailStatus): 'success' | 'warning' | 'error' => {
        const tone = getEmailStatusPresentation(status).tone;

        if (tone === 'success') {
            return 'success';
        }

        if (tone === 'warning' || tone === 'neutral') {
            return 'warning';
        }

        return 'error';
    };

    const [activeTab, setActiveTab] = useState<TabKey>('overview');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testingTransport, setTestingTransport] = useState<EmailTransport | null>(null);
    const [testingSend, setTestingSend] = useState(false);

    const [settings, setSettings] = useState<EmailSettings | null>(null);
    const [enabled, setEnabled] = useState(false);
    const [transport, setTransport] = useState<EmailTransport>('smtp');
    const [globalSender, setGlobalSender] = useState({ fromEmail: '', fromName: '', replyTo: '' });
    const [resendPlan, setResendPlan] = useState<ResendPlanKey>('free');
    const [resendPlanOptions, setResendPlanOptions] = useState<ResendPlanDefinition[]>([]);
    const [resendUsage, setResendUsage] = useState<ResendQuotaUsage | null>(null);
    const [customMonthlyLimit, setCustomMonthlyLimit] = useState('');
    const [customDailyLimit, setCustomDailyLimit] = useState('');

    const [resendApiKeyInput, setResendApiKeyInput] = useState('');
    const [resendKeySet, setResendKeySet] = useState(false);

    const [smtpConfig, setSmtpConfig] = useState({
        host: '',
        port: '',
        username: '',
        encryption: '',
        from_email: '',
        from_name: '',
        reply_to: '',
    });
    const [smtpPasswordInput, setSmtpPasswordInput] = useState('');
    const [smtpPasswordSet, setSmtpPasswordSet] = useState(false);

    const [testResults, setTestResults] = useState<{
        smtp?: TestResult;
        resend?: TestResult;
        delivery?: TestResult;
    }>({});
    const [testRecipient, setTestRecipient] = useState('');
    const [savingEnabled, setSavingEnabled] = useState(false);
    const [clearingApiKey, setClearingApiKey] = useState(false);
    const [clearingSmtpPassword, setClearingSmtpPassword] = useState(false);
    const [resettingSmtp, setResettingSmtp] = useState(false);

    const pickWithFallback = (primary?: string, smtpValue?: string, resendValue?: string, defaultValue = '') =>
        primary || smtpValue || resendValue || defaultValue;

    useEffect(() => {
        setLoading(true);
        getSettings()
            .then(data => {
                setSettings(data);
                setEnabled(data.enabled);
                setTransport(data.transport);
                setResendKeySet(data.resend.api_key);
                setSmtpPasswordSet(data.smtp.password_set);
                setResendPlan(data.resend_plan.key);
                setResendPlanOptions(data.resend_plans || []);
                setResendUsage(data.resend_usage);
                setCustomMonthlyLimit(
                    data.resend_plan.custom_monthly_limit !== null &&
                        data.resend_plan.custom_monthly_limit !== undefined
                        ? String(data.resend_plan.custom_monthly_limit)
                        : '',
                );
                setCustomDailyLimit(
                    data.resend_plan.custom_daily_limit !== null && data.resend_plan.custom_daily_limit !== undefined
                        ? String(data.resend_plan.custom_daily_limit)
                        : '',
                );

                const derivedFromEmail = pickWithFallback(
                    data.transport === 'smtp' ? data.smtp.from_email : data.resend.from_email,
                    data.smtp.from_email,
                    data.resend.from_email,
                );
                const derivedFromName = pickWithFallback(
                    data.transport === 'smtp' ? data.smtp.from_name : data.resend.from_name,
                    data.smtp.from_name,
                    data.resend.from_name,
                );
                const derivedReplyTo =
                    data.transport === 'smtp'
                        ? pickWithFallback(data.smtp.reply_to, data.resend.reply_to, undefined, derivedFromEmail)
                        : pickWithFallback(data.resend.reply_to, data.smtp.reply_to, undefined, derivedFromEmail);

                setGlobalSender({
                    fromEmail: derivedFromEmail,
                    fromName: derivedFromName,
                    replyTo: derivedReplyTo,
                });

                setSmtpConfig({
                    host: data.smtp.host || '',
                    port: (data.smtp.port || '').toString(),
                    username: data.smtp.username || '',
                    encryption: data.smtp.encryption || '',
                    from_email: data.smtp.from_email || derivedFromEmail,
                    from_name: data.smtp.from_name || derivedFromName,
                    reply_to: data.smtp.reply_to || derivedReplyTo,
                });
            })
            .catch(error => clearAndAddHttpError({ key: 'email:settings:load', error }))
            .finally(() => setLoading(false));
    }, []);

    const resolvedReplyTo = useMemo(
        () => globalSender.replyTo || globalSender.fromEmail,
        [globalSender.replyTo, globalSender.fromEmail],
    );

    useEffect(() => {
        setSmtpConfig(prev => ({
            ...prev,
            from_email: globalSender.fromEmail,
            from_name: globalSender.fromName,
            reply_to: resolvedReplyTo,
        }));
    }, [globalSender.fromEmail, globalSender.fromName, resolvedReplyTo]);

    const initialSender = useMemo(() => {
        if (!settings) {
            return { fromEmail: '', fromName: '', replyTo: '' };
        }

        const active = settings.transport === 'smtp' ? settings.smtp : settings.resend;

        return {
            fromEmail: pickWithFallback(active.from_email, settings.smtp.from_email, settings.resend.from_email),
            fromName: pickWithFallback(active.from_name, settings.smtp.from_name, settings.resend.from_name),
            replyTo: pickWithFallback(active.reply_to, settings.smtp.reply_to, settings.resend.reply_to),
        };
    }, [settings]);

    const initialPlan = useMemo(() => settings?.resend_plan, [settings]);

    const activePlan = useMemo(() => {
        if (resendPlanOptions.length === 0) {
            return settings?.resend_plan;
        }

        return resendPlanOptions.find(plan => plan.key === resendPlan) || resendPlanOptions[0] || settings?.resend_plan;
    }, [resendPlanOptions, resendPlan, settings]);

    const activeUsage = useMemo(() => resendUsage, [resendUsage]);

    const hasChanges = useMemo(() => {
        if (!settings) return false;

        const smtpPort = (settings.smtp.port || '').toString();

        return (
            enabled !== settings.enabled ||
            transport !== settings.transport ||
            globalSender.fromEmail !== initialSender.fromEmail ||
            globalSender.fromName !== initialSender.fromName ||
            globalSender.replyTo !== initialSender.replyTo ||
            smtpConfig.host !== (settings.smtp.host || '') ||
            smtpConfig.port !== smtpPort ||
            smtpConfig.username !== (settings.smtp.username || '') ||
            smtpConfig.encryption !== (settings.smtp.encryption || '') ||
            resendApiKeyInput.trim().length > 0 ||
            smtpPasswordInput.trim().length > 0 ||
            resendPlan !== settings.resend_plan.key ||
            (initialPlan &&
                (customMonthlyLimit || '') !==
                    (initialPlan.custom_monthly_limit !== null && initialPlan.custom_monthly_limit !== undefined
                        ? String(initialPlan.custom_monthly_limit)
                        : '')) ||
            (initialPlan &&
                (customDailyLimit || '') !==
                    (initialPlan.custom_daily_limit !== null && initialPlan.custom_daily_limit !== undefined
                        ? String(initialPlan.custom_daily_limit)
                        : ''))
        );
    }, [
        enabled,
        transport,
        globalSender.fromEmail,
        globalSender.fromName,
        globalSender.replyTo,
        smtpConfig.host,
        smtpConfig.port,
        smtpConfig.username,
        smtpConfig.encryption,
        resendApiKeyInput,
        smtpPasswordInput,
        settings,
        initialSender.fromEmail,
        initialSender.fromName,
        initialSender.replyTo,
        resendPlan,
        customMonthlyLimit,
        customDailyLimit,
        initialPlan,
    ]);

    const smtpConfigured = useMemo(() => {
        const hasPassword = smtpPasswordSet || smtpPasswordInput.trim().length > 0 || !smtpConfig.username;

        return Boolean(smtpConfig.host && smtpConfig.port && hasPassword && globalSender.fromEmail);
    }, [smtpConfig, smtpPasswordInput, smtpPasswordSet, globalSender.fromEmail]);

    const resendConfigured = useMemo(() => {
        return Boolean((resendKeySet || resendApiKeyInput.trim().length > 0) && globalSender.fromEmail);
    }, [resendApiKeyInput, resendKeySet, globalSender.fromEmail]);

    const currentStatus = useMemo(() => {
        if (!enabled) return 'Email delivery is disabled';
        if (transport === 'smtp' && !smtpConfigured) return 'SMTP configuration incomplete';
        if (transport === 'resend' && !resendConfigured) return 'Resend configuration incomplete';
        if (
            transport === 'resend' &&
            resendUsage &&
            ((resendUsage.monthly_limit !== null && resendUsage.monthly_remaining === 0) ||
                (resendUsage.daily_limit !== null && resendUsage.daily_remaining === 0))
        ) {
            return 'Resend quota reached — sending will be deferred';
        }

        if (testResults.delivery && testResults.delivery.status !== 'sent') {
            return 'Delivery test failed — see details below';
        }

        return 'Ready';
    }, [enabled, transport, smtpConfigured, resendConfigured, testResults.delivery, resendUsage]);

    const lastSuccess =
        (testResults.delivery?.status === 'sent' && testResults.delivery) ||
        (testResults[transport]?.status === 'sent' ? testResults[transport] : undefined);

    const handleSave = () => {
        if (!settings) return;
        setSaving(true);
        clearFlashes('email:settings');
        setStatus('loading');

        const payload: EmailSettingsUpdate = {
            enabled,
            transport,
            from_email: globalSender.fromEmail,
            from_name: globalSender.fromName,
            reply_to: globalSender.replyTo,
            smtp_host: smtpConfig.host,
            smtp_port: smtpConfig.port,
            smtp_username: smtpConfig.username,
            smtp_encryption: smtpConfig.encryption,
            smtp_from_email: globalSender.fromEmail,
            smtp_from_name: globalSender.fromName,
            smtp_reply_to: globalSender.replyTo,
            resend_plan: resendPlan,
        };

        if (resendApiKeyInput.trim()) {
            payload.api_key = resendApiKeyInput.trim();
        }

        if (smtpPasswordInput.trim()) {
            payload.smtp_password = smtpPasswordInput.trim();
        }

        const trimmedMonthly = customMonthlyLimit.trim();
        const trimmedDaily = customDailyLimit.trim();

        if (trimmedMonthly.length || resendPlan === 'enterprise') {
            payload.resend_custom_monthly_limit = trimmedMonthly.length ? Number(trimmedMonthly) : null;
        }

        if (trimmedDaily.length || resendPlan === 'enterprise') {
            payload.resend_custom_daily_limit = trimmedDaily.length ? Number(trimmedDaily) : null;
        }

        updateSettings(payload)
            .then(updated => {
                setSettings(updated);
                setEnabled(updated.enabled);
                setTransport(updated.transport);
                setResendKeySet(updated.resend.api_key);
                setSmtpPasswordSet(updated.smtp.password_set);
                setResendPlan(updated.resend_plan.key);
                setResendPlanOptions(updated.resend_plans || []);
                setResendUsage(updated.resend_usage);
                setCustomMonthlyLimit(
                    updated.resend_plan.custom_monthly_limit !== null &&
                        updated.resend_plan.custom_monthly_limit !== undefined
                        ? String(updated.resend_plan.custom_monthly_limit)
                        : '',
                );
                setCustomDailyLimit(
                    updated.resend_plan.custom_daily_limit !== null &&
                        updated.resend_plan.custom_daily_limit !== undefined
                        ? String(updated.resend_plan.custom_daily_limit)
                        : '',
                );
                setResendApiKeyInput('');
                setSmtpPasswordInput('');
                setGlobalSender({
                    fromEmail: updated.resend.from_email || updated.smtp.from_email || globalSender.fromEmail,
                    fromName: updated.resend.from_name || updated.smtp.from_name || globalSender.fromName,
                    replyTo: updated.resend.reply_to || updated.smtp.reply_to || globalSender.replyTo,
                });

                setSmtpConfig(prev => ({
                    ...prev,
                    host: updated.smtp.host || '',
                    port: (updated.smtp.port || '').toString(),
                    username: updated.smtp.username || '',
                    encryption: updated.smtp.encryption || '',
                }));

                addFlash({
                    key: 'email:settings',
                    type: 'success',
                    message: 'Email settings saved successfully.',
                });
                setStatus('success');
            })
            .catch(error => {
                setStatus('error');
                clearAndAddHttpError({ key: 'email:settings', error });
            })
            .finally(() => setSaving(false));
    };

    const handleToggleEnabled = () => {
        if (!settings || savingEnabled) return;

        const newEnabled = !enabled;
        setEnabled(newEnabled);
        setSavingEnabled(true);
        clearFlashes('email:settings');
        setStatus('loading');

        updateSettings({ enabled: newEnabled })
            .then(updated => {
                setSettings(updated);
                setEnabled(updated.enabled);
                setTransport(updated.transport);
                addFlash({
                    key: 'email:settings',
                    type: 'success',
                    message: `Email delivery ${updated.enabled ? 'enabled' : 'disabled'}.`,
                });
                setStatus('success');
            })
            .catch(error => {
                setEnabled(!newEnabled); // revert
                setStatus('error');
                clearAndAddHttpError({ key: 'email:settings', error });
            })
            .finally(() => setSavingEnabled(false));
    };

    const handleClearResendApiKey = () => {
        if (clearingApiKey || !settings?.resend.api_key) return;

        clearFlashes('email:settings:resend');
        setClearingApiKey(true);
        setStatus('loading');

        updateSettings({ api_key: '', clear_api_key: true })
            .then(updated => {
                setSettings(updated);
                setResendKeySet(updated.resend.api_key);
                setResendApiKeyInput('');
                addFlash({
                    key: 'email:settings:resend',
                    type: 'success',
                    message: 'Resend API key deleted.',
                });
                setStatus('success');
            })
            .catch(error => {
                setStatus('error');
                clearAndAddHttpError({ key: 'email:settings:resend', error });
            })
            .finally(() => setClearingApiKey(false));
    };

    const handleClearSmtpPassword = () => {
        if (clearingSmtpPassword || !settings?.smtp.password_set) return;

        clearFlashes('email:settings:smtp');
        setClearingSmtpPassword(true);
        setStatus('loading');

        updateSettings({ smtp_password: '', clear_smtp_password: true })
            .then(updated => {
                setSettings(updated);
                setSmtpPasswordSet(updated.smtp.password_set);
                setSmtpPasswordInput('');
                addFlash({
                    key: 'email:settings:smtp',
                    type: 'success',
                    message: 'SMTP password cleared.',
                });
                setStatus('success');
            })
            .catch(error => {
                setStatus('error');
                clearAndAddHttpError({ key: 'email:settings:smtp', error });
            })
            .finally(() => setClearingSmtpPassword(false));
    };

    const handleResetSmtp = () => {
        if (resettingSmtp) return;

        clearFlashes('email:settings:smtp');
        setResettingSmtp(true);
        setStatus('loading');

        const payload: EmailSettingsUpdate = {
            smtp_host: '',
            smtp_port: '',
            smtp_username: '',
            smtp_encryption: '',
            smtp_from_email: '',
            smtp_from_name: '',
            smtp_reply_to: '',
            smtp_password: '',
            clear_smtp_password: true,
        };

        updateSettings(payload)
            .then(updated => {
                setSettings(updated);
                setSmtpPasswordSet(false);
                setSmtpPasswordInput('');
                setSmtpConfig({
                    host: '',
                    port: '',
                    username: '',
                    encryption: '',
                    from_email: '',
                    from_name: '',
                    reply_to: '',
                });
                addFlash({
                    key: 'email:settings:smtp',
                    type: 'success',
                    message: 'SMTP settings reset and password cleared.',
                });
                setStatus('success');
            })
            .catch(error => {
                setStatus('error');
                clearAndAddHttpError({ key: 'email:settings:smtp', error });
            })
            .finally(() => setResettingSmtp(false));
    };

    const handleTransportChange = (value: EmailTransport) => {
        setTransport(value);
    };

    const handleConnectionCheck = (checkedTransport: EmailTransport) => {
        setTestingTransport(checkedTransport);
        clearFlashes('email:settings:test');
        const tester = checkedTransport === 'smtp' ? testSmtpConnection : testResendConnection;

        tester()
            .then(response => {
                const status = resolveEmailResponseStatus(response);
                const message = response.success
                    ? getConnectionCheckSuccessMessage(response)
                    : extractErrorMessage(response.error, 'Connection check failed');

                const code =
                    !response.success && response.error && typeof response.error !== 'string'
                        ? response.error.code
                        : undefined;

                setTestResults(prev => ({
                    ...prev,
                    [checkedTransport]: {
                        status,
                        transport: checkedTransport,
                        message,
                        tested_at: getEmailResponseTimestamp(response),
                        code,
                    },
                }));

                addFlash({
                    key: 'email:settings:test',
                    type: getFlashType(status),
                    message,
                });
            })
            .catch(error => clearAndAddHttpError({ key: 'email:settings:test', error }))
            .finally(() => setTestingTransport(null));
    };

    const handleSendTestEmail = () => {
        if (!testRecipient) {
            addFlash({
                key: 'email:settings:test',
                type: 'error',
                message: 'Enter a recipient email first.',
            });
            return;
        }

        setTestingSend(true);
        clearFlashes('email:settings:test');

        sendTestEmail({ to: testRecipient })
            .then(response => {
                const status = resolveEmailResponseStatus(response);
                const responseTransport = response.transport || response.provider || transport;

                const message =
                    status === 'sent'
                        ? getDeliveryTestSuccessMessage(response, transport)
                        : extractErrorMessage(response.error, 'Failed to send delivery test email');

                setTestResults(prev => ({
                    ...prev,
                    delivery: {
                        status,
                        transport: responseTransport,
                        message,
                        tested_at: getEmailResponseTimestamp(response),
                        code:
                            status !== 'sent' && response.error && typeof response.error !== 'string'
                                ? response.error.code
                                : undefined,
                    },
                }));

                addFlash({
                    key: 'email:settings:test',
                    type: getFlashType(status),
                    message,
                });
            })
            .catch(error => clearAndAddHttpError({ key: 'email:settings:test', error }))
            .finally(() => setTestingSend(false));
    };

    if (loading || !settings) {
        return (
            <AdminBox title={'Email Settings'} icon={faEnvelope}>
                <div className={'flex items-center justify-center py-8'}>
                    <FontAwesomeIcon icon={faVial} className={'fa-spin text-gray-400'} size={'2x'} />
                </div>
            </AdminBox>
        );
    }

    return (
        <AdminBox title={'Email Settings'} icon={faEnvelope} status={status}>
            <div className={'flex flex-col gap-5'}>
                <TabList active={activeTab} onSelect={setActiveTab} primary={primary} />

                {activeTab === 'overview' && (
                    <div className={'space-y-4'}>
                        <div className={'grid grid-cols-1 gap-4 lg:grid-cols-3'}>
                            <Card className={'h-full'}>
                                <div className={'flex h-full flex-col justify-between gap-3'}>
                                    <div className={'flex items-center justify-between'}>
                                        <div className={'space-y-1'}>
                                            <Label>Email system</Label>
                                            <p className={'text-sm text-gray-400'}>
                                                Toggle delivery for all configured transports.
                                            </p>
                                        </div>
                                        <div className={'flex items-center gap-2'}>
                                            <StatusBadge status={enabled ? 'success' : 'warning'} />
                                            {(enabled ? Button.Danger : Button.Success)({
                                                children: enabled ? 'Disable' : 'Enable',
                                                onClick: handleToggleEnabled,
                                                disabled: saving || savingEnabled,
                                            })}
                                        </div>
                                    </div>
                                    <p className={'text-xs text-gray-500'}>
                                        Applies immediately and affects all transports.
                                    </p>
                                </div>
                            </Card>

                            <Card className={'h-full'}>
                                <div className={'flex h-full flex-col justify-between gap-3'}>
                                    <div className={'space-y-2'}>
                                        <Label>Active transport</Label>
                                        <div className={'grid grid-cols-2 gap-2'}>
                                            <ProviderPill
                                                label={'SMTP'}
                                                active={transport === 'smtp'}
                                                onClick={() => handleTransportChange('smtp')}
                                                primary={primary}
                                            />
                                            <ProviderPill
                                                label={'Resend'}
                                                active={transport === 'resend'}
                                                onClick={() => handleTransportChange('resend')}
                                                primary={primary}
                                            />
                                        </div>
                                    </div>
                                    <p className={'text-xs text-gray-500'}>
                                        Switching transports preserves your saved configuration.
                                    </p>
                                </div>
                            </Card>

                            <Card className={'h-full'}>
                                <div className={'flex h-full flex-col justify-between gap-3'}>
                                    <div className={'flex items-start justify-between'}>
                                        <div>
                                            <Label>Current status</Label>
                                            <p className={'text-sm text-gray-300'}>{currentStatus}</p>
                                        </div>
                                        <StatusBadge status={currentStatus === 'Ready' ? 'success' : 'warning'} />
                                    </div>
                                    <div className={'text-xs text-gray-500'}>
                                        {lastSuccess
                                            ? `Last successful connection check or delivery: ${new Date(
                                                  lastSuccess.tested_at,
                                              ).toLocaleString()}`
                                            : 'No successful connection checks or delivery tests yet.'}
                                    </div>
                                </div>
                            </Card>
                        </div>

                        <Card>
                            <div className={'space-y-3'}>
                                <Label>Global sender identity</Label>
                                <div className={'grid grid-cols-1 gap-4 sm:grid-cols-2'}>
                                    <div className={'space-y-1'}>
                                        <Label>From Name</Label>
                                        <Input
                                            value={globalSender.fromName}
                                            onChange={e =>
                                                setGlobalSender(prev => ({ ...prev, fromName: e.target.value }))
                                            }
                                            placeholder={'Your App'}
                                        />
                                    </div>
                                    <div className={'space-y-1'}>
                                        <Label>
                                            From Email <span className={'text-red-500'}>*</span>
                                        </Label>
                                        <Input
                                            type={'email'}
                                            value={globalSender.fromEmail}
                                            onChange={e =>
                                                setGlobalSender(prev => ({ ...prev, fromEmail: e.target.value }))
                                            }
                                            placeholder={'noreply@yourdomain.com'}
                                        />
                                    </div>
                                    <div className={'space-y-1'}>
                                        <Label>Reply-To Email</Label>
                                        <Input
                                            type={'email'}
                                            value={globalSender.replyTo}
                                            onChange={e =>
                                                setGlobalSender(prev => ({ ...prev, replyTo: e.target.value }))
                                            }
                                            placeholder={'support@yourdomain.com'}
                                        />
                                    </div>
                                </div>
                            </div>
                        </Card>

                        <div className={'grid grid-cols-1 gap-4 lg:grid-cols-2'}>
                            <StatusCard
                                title={'SMTP'}
                                active={transport === 'smtp'}
                                configured={smtpConfigured}
                                lastTest={testResults.smtp}
                                onTest={() => handleConnectionCheck('smtp')}
                                testing={testingTransport === 'smtp'}
                            />
                            <StatusCard
                                title={'Resend'}
                                active={transport === 'resend'}
                                configured={resendConfigured}
                                lastTest={testResults.resend}
                                onTest={() => handleConnectionCheck('resend')}
                                testing={testingTransport === 'resend'}
                            />
                        </div>
                    </div>
                )}

                {activeTab === 'smtp' && (
                    <div className={'space-y-4'}>
                        <Card>
                            <div className={'flex items-center justify-between'}>
                                <div className={'space-y-1'}>
                                    <Label>SMTP connection</Label>
                                    <p className={'text-sm text-gray-400'}>Server and authentication settings.</p>
                                </div>
                                <span
                                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                        transport === 'smtp'
                                            ? 'bg-green-900 text-green-100'
                                            : 'bg-neutral-800 text-gray-300'
                                    }`}
                                >
                                    {transport === 'smtp' ? 'Active transport' : 'Inactive'}
                                </span>
                            </div>
                            <div
                                className={`mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 ${
                                    transport !== 'smtp' ? 'opacity-70' : ''
                                }`}
                            >
                                <InputField
                                    label={'Host'}
                                    value={smtpConfig.host}
                                    onChange={value => setSmtpConfig(prev => ({ ...prev, host: value }))}
                                    placeholder={'smtp.yourdomain.com'}
                                />
                                <InputField
                                    label={'Port'}
                                    value={smtpConfig.port}
                                    onChange={value => setSmtpConfig(prev => ({ ...prev, port: value }))}
                                    placeholder={'587'}
                                    type={'number'}
                                />
                                <InputField
                                    label={'Username'}
                                    value={smtpConfig.username}
                                    onChange={value => setSmtpConfig(prev => ({ ...prev, username: value }))}
                                    placeholder={'user@yourdomain.com'}
                                />
                                <div className={'space-y-1'}>
                                    <Label>Password</Label>
                                    <Input
                                        type={'password'}
                                        value={smtpPasswordInput}
                                        onChange={e => setSmtpPasswordInput(e.target.value)}
                                        placeholder={smtpPasswordSet ? '•••••••• (saved)' : 'Enter SMTP password'}
                                    />
                                    <p className={'text-xs text-gray-500'}>
                                        Leave blank to keep the existing password.
                                    </p>
                                    <div className={'flex flex-wrap gap-2'}>
                                        <Button.Danger
                                            size={Button.Sizes.Small}
                                            onClick={handleClearSmtpPassword}
                                            disabled={!settings?.smtp.password_set || clearingSmtpPassword}
                                            loading={clearingSmtpPassword}
                                        >
                                            Clear password
                                        </Button.Danger>
                                        <Button.Danger
                                            size={Button.Sizes.Small}
                                            onClick={handleResetSmtp}
                                            disabled={resettingSmtp}
                                            loading={resettingSmtp}
                                        >
                                            Reset SMTP settings
                                        </Button.Danger>
                                    </div>
                                </div>
                                <div className={'space-y-1'}>
                                    <Label>Encryption</Label>
                                    <select
                                        className={
                                            'w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-white'
                                        }
                                        value={smtpConfig.encryption}
                                        onChange={e => setSmtpConfig(prev => ({ ...prev, encryption: e.target.value }))}
                                    >
                                        <option value="">None</option>
                                        <option value="tls">TLS</option>
                                        <option value="ssl">SSL</option>
                                    </select>
                                </div>
                            </div>
                        </Card>

                        <Card>
                            <div className={'flex items-center justify-between'}>
                                <div className={'space-y-1'}>
                                    <Label>Status</Label>
                                    <p className={'text-sm text-gray-300'}>
                                        {smtpConfigured ? 'Configured' : 'Missing required fields'}
                                    </p>
                                    <p className={'text-xs text-gray-500'}>
                                        Password set: {smtpPasswordSet ? 'Yes' : 'No'}
                                    </p>
                                    <p className={'text-xs text-gray-500'}>
                                        Uses the configured sender identity, not the recipient delivery test field.
                                    </p>
                                </div>
                                <Button
                                    onClick={() => handleConnectionCheck('smtp')}
                                    loading={testingTransport === 'smtp'}
                                    size={Button.Sizes.Small}
                                >
                                    <FontAwesomeIcon icon={faVial} className={'mr-1'} />
                                    {getConnectionCheckButtonLabel('smtp')}
                                </Button>
                            </div>
                            {testResults.smtp && <ResultBanner result={testResults.smtp} />}
                        </Card>
                    </div>
                )}

                {activeTab === 'resend' && (
                    <div className={'space-y-4'}>
                        <Card>
                            <div className={'flex items-center justify-between'}>
                                <div className={'space-y-1'}>
                                    <Label>Resend configuration</Label>
                                    <p className={'text-sm text-gray-400'}>API access.</p>
                                </div>
                                <span
                                    className={`rounded-full px-3 py-1 text-xs font-semibold ${
                                        transport === 'resend'
                                            ? 'bg-green-900 text-green-100'
                                            : 'bg-neutral-800 text-gray-300'
                                    }`}
                                >
                                    {transport === 'resend' ? 'Active transport' : 'Inactive'}
                                </span>
                            </div>

                            <div
                                className={`mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 ${
                                    transport !== 'resend' ? 'opacity-70' : ''
                                }`}
                            >
                                <div className={'space-y-1'}>
                                    <Label>API Key</Label>
                                    <Input
                                        type={'password'}
                                        value={resendApiKeyInput}
                                        onChange={e => setResendApiKeyInput(e.target.value)}
                                        placeholder={
                                            resendKeySet ? 'Key saved — enter to replace' : 'Enter Resend API key'
                                        }
                                    />
                                    <p className={'text-xs text-gray-500'}>
                                        Keys are stored securely. Leave blank to keep the existing key.
                                    </p>
                                    <div className={'flex flex-wrap gap-2'}>
                                        <Button.Danger
                                            onClick={handleClearResendApiKey}
                                            disabled={!resendKeySet || clearingApiKey}
                                            loading={clearingApiKey}
                                            size={Button.Sizes.Small}
                                        >
                                            Delete saved key
                                        </Button.Danger>
                                    </div>
                                </div>
                            </div>
                        </Card>

                        <Card>
                            <div className={'space-y-3'}>
                                <div className={'flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'}>
                                    <div className={'space-y-1'}>
                                        <Label>Resend plan</Label>
                                        <p className={'text-sm text-gray-400'}>
                                            Select the active Resend tier to enforce daily and monthly quotas.
                                        </p>
                                    </div>
                                    <select
                                        className={'rounded border px-3 py-2 text-sm text-white'}
                                        style={{ backgroundColor: secondary, borderColor: headers }}
                                        value={resendPlan}
                                        onChange={e => setResendPlan(e.target.value as ResendPlanKey)}
                                    >
                                        {resendPlanOptions.map(plan => (
                                            <option key={plan.key} value={plan.key}>
                                                {plan.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                {activePlan?.allows_custom_limits && (
                                    <div className={'grid grid-cols-1 gap-3 sm:grid-cols-2'}>
                                        <InputField
                                            label={'Monthly limit (leave blank for unlimited)'}
                                            value={customMonthlyLimit}
                                            onChange={setCustomMonthlyLimit}
                                            placeholder={'e.g. 250000'}
                                            type={'number'}
                                        />
                                        <InputField
                                            label={'Daily limit (optional)'}
                                            value={customDailyLimit}
                                            onChange={setCustomDailyLimit}
                                            placeholder={'e.g. 5000'}
                                            type={'number'}
                                        />
                                    </div>
                                )}

                                <div className={'grid grid-cols-1 gap-3 sm:grid-cols-2'}>
                                    <UsageStat
                                        label={'Daily quota'}
                                        sent={activeUsage?.daily_sent ?? 0}
                                        limit={
                                            activePlan?.enforce_daily
                                                ? (activeUsage?.daily_limit ?? activePlan?.daily_limit ?? null)
                                                : null
                                        }
                                        applies={Boolean(
                                            activePlan?.enforce_daily &&
                                            (activePlan?.daily_limit !== null || activeUsage?.daily_limit !== null),
                                        )}
                                    />
                                    <UsageStat
                                        label={'Monthly quota'}
                                        sent={activeUsage?.monthly_sent ?? 0}
                                        limit={
                                            activePlan?.enforce_monthly
                                                ? (activeUsage?.monthly_limit ?? activePlan?.monthly_limit ?? null)
                                                : null
                                        }
                                        applies={Boolean(
                                            activePlan?.enforce_monthly &&
                                            (activePlan?.monthly_limit !== null || activeUsage?.monthly_limit !== null),
                                        )}
                                    />
                                </div>
                                <p className={'text-xs text-gray-500'}>
                                    Source:{' '}
                                    {activeUsage?.source === 'provider' ? 'Provider reported' : 'Internal fallback'}
                                    {activeUsage?.synced_at
                                        ? ` • Updated ${new Date(activeUsage.synced_at).toLocaleString()}`
                                        : ''}
                                </p>
                                {settings.resend_rate_limit && (
                                    <p className={'text-xs text-gray-500'}>
                                        Rate limit — limit: {settings.resend_rate_limit.limit ?? 'n/a'}, remaining:{' '}
                                        {settings.resend_rate_limit.remaining ?? 'n/a'}, reset:{' '}
                                        {settings.resend_rate_limit.reset ?? 'n/a'}, retry-after:{' '}
                                        {settings.resend_rate_limit.retry_after ?? 'n/a'}
                                    </p>
                                )}
                                <p className={'text-xs text-gray-500'}>
                                    Plan quotas are tracked separately from Resend API rate limits (5 requests/second).
                                    When a quota is reached, emails are deferred to the queue until the next reset.
                                </p>
                            </div>
                        </Card>

                        <Card>
                            <div className={'flex items-center justify-between'}>
                                <div className={'space-y-1'}>
                                    <Label>Status</Label>
                                    <p className={'text-sm text-gray-300'}>
                                        {resendConfigured ? 'Configured' : 'Missing required fields'}
                                    </p>
                                    <p className={'text-xs text-gray-500'}>
                                        API key set: {resendKeySet ? 'Yes' : 'No'}
                                    </p>
                                    <p className={'text-xs text-gray-500'}>
                                        Uses the configured sender identity, not the recipient delivery test field.
                                    </p>
                                </div>
                                <Button
                                    onClick={() => handleConnectionCheck('resend')}
                                    loading={testingTransport === 'resend'}
                                    size={Button.Sizes.Small}
                                >
                                    <FontAwesomeIcon icon={faVial} className={'mr-1'} />
                                    {getConnectionCheckButtonLabel('resend')}
                                </Button>
                            </div>
                            {testResults.resend && <ResultBanner result={testResults.resend} />}
                        </Card>
                    </div>
                )}

                {activeTab === 'testing' && (
                    <div className={'space-y-4'}>
                        <Card>
                            <div className={'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'}>
                                <div>
                                    <Label>Send delivery test email</Label>
                                    <p className={'text-sm text-gray-400'}>{getDeliveryTestDescription(transport)}</p>
                                </div>
                                <StatusBadge status={transport === 'smtp' ? 'info' : 'secondary'} />
                            </div>
                            <div className={'mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]'}>
                                <Input
                                    type={'email'}
                                    value={testRecipient}
                                    onChange={e => setTestRecipient(e.target.value)}
                                    placeholder={'recipient@example.com'}
                                />
                                <Button onClick={handleSendTestEmail} loading={testingSend} disabled={!testRecipient}>
                                    <FontAwesomeIcon icon={faPaperPlane} className={'mr-2'} />
                                    Send Delivery Test
                                </Button>
                            </div>
                            {testResults.delivery && <ResultBanner result={testResults.delivery} />}
                        </Card>
                        <Card>
                            <div className={'space-y-2'}>
                                <Label>Tips</Label>
                                <ul className={'list-disc space-y-1 pl-5 text-sm text-gray-400'}>
                                    <li>Use a monitored inbox for Reply-To to capture responses.</li>
                                    <li>Configure SPF/DKIM for your domain to avoid spam folders.</li>
                                    <li>
                                        Connection checks validate credentials and transport configuration without
                                        targeting a test recipient.
                                    </li>
                                    <li>
                                        Delivery tests send a real email so you can verify end-to-end delivery and inbox
                                        placement.
                                    </li>
                                </ul>
                            </div>
                        </Card>
                    </div>
                )}

                <div
                    className={
                        'flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between'
                    }
                    style={{ backgroundColor: secondary, borderColor: headers }}
                >
                    <p className={'text-sm font-semibold text-white'}>Save Settings</p>
                    <div className={'flex items-center gap-3'}>
                        {!hasChanges && <span className={'text-xs text-gray-400'}>No changes to save</span>}
                        <Button onClick={handleSave} disabled={!hasChanges || saving} loading={saving}>
                            Save
                        </Button>
                    </div>
                </div>
            </div>
        </AdminBox>
    );
};

const TabList = ({
    active,
    onSelect,
    primary,
}: {
    active: TabKey;
    onSelect: (tab: TabKey) => void;
    primary: string;
}) => {
    const tabs: Array<{ key: TabKey; label: string; icon: IconProp }> = [
        { key: 'overview', label: 'Overview', icon: faEnvelope },
        { key: 'smtp', label: 'SMTP', icon: faServer },
        { key: 'resend', label: 'Resend', icon: faPlug },
        { key: 'testing', label: 'Testing', icon: faVial },
    ];

    return (
        <div className={'border-b border-neutral-700'}>
            <div className={'flex flex-wrap gap-4'}>
                {tabs.map(tab => {
                    const isActive = active === tab.key;
                    return (
                        <button
                            key={tab.key}
                            type={'button'}
                            onClick={() => onSelect(tab.key)}
                            className={
                                'flex items-center gap-2 px-2 pb-2 text-sm font-semibold border-b-2 transition-colors'
                            }
                            style={{
                                borderBottomColor: isActive ? primary : 'transparent',
                                color: isActive ? '#fff' : '#9ca3af',
                            }}
                        >
                            <FontAwesomeIcon icon={tab.icon} />
                            {tab.label}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

const Card = ({ children, className }: { children: ReactNode; className?: string }) => {
    const { headers } = useStoreState(state => state.theme.data!.colors);
    return (
        <div
            className={`rounded-lg border p-4 ${className ?? ''}`}
            style={{ backgroundColor: headers, borderColor: '#00000040' }}
        >
            {children}
        </div>
    );
};

const ProviderPill = ({
    label,
    active,
    onClick,
    primary,
}: {
    label: string;
    active: boolean;
    onClick: () => void;
    primary: string;
}) => (
    <button
        type={'button'}
        onClick={onClick}
        className={`flex w-full items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition-colors ${
            active ? 'text-white' : 'text-gray-200 hover:text-white'
        } ${active ? '' : 'bg-neutral-800 border-neutral-700 hover:border-neutral-500'}`}
        style={active ? { backgroundColor: primary, borderColor: primary } : undefined}
    >
        <span
            className={`h-2 w-2 rounded-full ${active ? '' : 'bg-neutral-600'}`}
            style={active ? { backgroundColor: '#ffffff' } : undefined}
        />
        {label}
    </button>
);

const InputField = ({
    label,
    value,
    onChange,
    placeholder,
    type = 'text',
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    type?: string;
}) => (
    <div className={'space-y-1'}>
        <Label>{label}</Label>
        <Input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} type={type} />
    </div>
);

const StatusBadge = ({ status }: { status: 'success' | 'warning' | 'info' | 'secondary' }) => {
    const label =
        status === 'success' ? 'Success' : status === 'warning' ? 'Warning' : status === 'info' ? 'Info' : 'Status';
    const map = {
        success: <Pill type={'success'}>{label}</Pill>,
        warning: <Pill type={'danger'}>{label}</Pill>,
        info: <Pill type={'info'}>{label}</Pill>,
        secondary: <Pill>{label}</Pill>,
    } as const;

    return map[status];
};

const StatusCard = ({
    title,
    active,
    configured,
    lastTest,
    onTest,
    testing,
}: {
    title: string;
    active: boolean;
    configured: boolean;
    lastTest?: TestResult;
    onTest: () => void;
    testing: boolean;
}) => {
    const { headers } = useStoreState(state => state.theme.data!.colors);

    return (
        <div
            className={'flex h-full flex-col gap-3 rounded-lg border p-4'}
            style={{ backgroundColor: headers, borderColor: '#00000040' }}
        >
            <div className={'flex flex-wrap items-center justify-between gap-3'}>
                <div className={'space-y-1'}>
                    <h3 className={'text-lg font-semibold text-white'}>{title}</h3>
                    <div className={'flex flex-wrap gap-2 text-sm text-gray-300'}>
                        <Pill type={active ? 'success' : 'danger'}>{active ? 'Active' : 'Inactive'}</Pill>
                        <Pill type={configured ? 'success' : 'danger'}>{configured ? 'Configured' : 'Incomplete'}</Pill>
                    </div>
                </div>
                <Button onClick={onTest} loading={testing} size={Button.Sizes.Small}>
                    <FontAwesomeIcon icon={faVial} className={'mr-1'} />
                    Check connection
                </Button>
            </div>
            <div className={'text-sm text-gray-300'}>
                {lastTest
                    ? `${lastTest.status === 'sent' ? 'Last connection check' : 'Last result'} • ${new Date(
                          lastTest.tested_at,
                      ).toLocaleString()}`
                    : 'No connection checks yet'}
            </div>
        </div>
    );
};

const ResultBanner = ({ result }: { result: TestResult }) => (
    <div
        className={`mt-3 rounded-md border p-3 text-sm ${
            getEmailStatusPresentation(result.status).tone === 'success'
                ? 'border-green-600/50 bg-green-950/40 text-green-100'
                : getEmailStatusPresentation(result.status).tone === 'warning'
                  ? 'border-yellow-500/50 bg-yellow-950/40 text-yellow-100'
                  : getEmailStatusPresentation(result.status).tone === 'neutral'
                    ? 'border-neutral-600/50 bg-neutral-900 text-neutral-100'
                    : 'border-amber-500/50 bg-amber-950/40 text-amber-100'
        }`}
    >
        <div className={'flex items-center justify-between'}>
            <span className={'font-semibold'}>
                {getEmailStatusPresentation(result.status).label} — {result.transport.toUpperCase()}
            </span>
            <span className={'text-xs text-gray-300'}>{formatTestFlowDate(result.tested_at)}</span>
        </div>
        <p className={'mt-1 text-sm text-white'}>{result.message}</p>
        {result.code && <p className={'text-xs text-gray-400'}>Code: {result.code}</p>}
    </div>
);

const extractErrorMessage = (error: unknown, fallback: string) => {
    if (!error) return fallback;
    if (typeof error === 'string') return error;
    if (typeof error === 'object' && error !== null && 'message' in error) {
        const message = (error as { message?: string }).message;
        return message || fallback;
    }
    return fallback;
};

const UsageStat = ({
    label,
    sent,
    limit,
    applies,
}: {
    label: string;
    sent: number;
    limit: number | null;
    applies: boolean;
}) => {
    const { primary, headers, secondary } = useStoreState(state => state.theme.data!.colors);
    const limitLabel = !applies ? 'No cap' : limit === null ? 'Unlimited' : limit.toLocaleString();
    const progress = applies && limit ? Math.min(100, Math.round((sent / limit) * 100)) : 0;
    const remaining = applies && limit !== null ? Math.max(0, limit - sent).toLocaleString() : '—';

    return (
        <div className={'rounded-md border p-3'} style={{ backgroundColor: secondary, borderColor: headers }}>
            <div className={'flex items-center justify-between'}>
                <Label>{label}</Label>
                <Pill type={applies ? 'info' : 'success'}>{applies ? 'Enforced' : 'Not applied'}</Pill>
            </div>
            <p className={'text-sm text-gray-300'}>
                {sent.toLocaleString()} / {limitLabel}
            </p>
            {applies && limit !== null && (
                <div className={'mt-2 h-2 overflow-hidden rounded'} style={{ backgroundColor: headers }}>
                    <div
                        className={'h-full'}
                        style={{
                            width: `${progress}%`,
                            backgroundColor: primary,
                        }}
                    />
                </div>
            )}
            <p className={'mt-1 text-xs text-gray-500'}>Remaining: {remaining}</p>
        </div>
    );
};

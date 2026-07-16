import { m } from '@/i18n';
import { abs } from '@/lib/base';
import { useState } from 'react';
import { Link2, CheckCircle2, AlertTriangle, Send, PowerOff } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { updateWebhookSetting, sendTestWebhook } from '@/api/webhooks';
import { SettingsCard, LabeledField } from '../../email/parts';
import { webhookConfig } from '../WebhooksSection';

// The Everest bootstrap only exposes whether a URL is configured (never the raw
// value), so the field always starts empty and submitting replaces it.
const SAMPLE_PAYLOAD = JSON.stringify(
    {
        event: 'admin:servers:create',
        timestamp: '2026-01-01T12:00:00Z',
        data: {},
    },
    null,
    2,
);

// After a module toggle the bootstrap must be re-read, so we hard-navigate.
function reloadSection() {
    window.location.assign(abs('/admin/webhooks'));
}

export default function ConfigurationPage() {
    const push = useFlashes(s => s.push);
    const { urlConfigured } = webhookConfig();

    const [url, setUrl] = useState('');
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [confirmDisable, setConfirmDisable] = useState(false);
    const [disabling, setDisabling] = useState(false);
    const [savedOnce, setSavedOnce] = useState(false);

    // The bootstrap `url` boolean is only refreshed on a full reload, so track
    // an in-session save to keep the "configured" indicator and test action live
    // without discarding the success toast (V1 stays on the page after saving).
    const configured = urlConfigured || savedOnce;

    const saveUrl = async () => {
        setSaving(true);
        try {
            await updateWebhookSetting('url', url.trim());
            setSavedOnce(true);
            push({ type: 'success', message: m['admin.webhooks.config.urlSaved']() });
        } catch (err) {
            push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() });
        } finally {
            setSaving(false);
        }
    };

    const test = async () => {
        if (!configured) {
            push({ type: 'error', message: m['admin.webhooks.config.testNoUrl']() });
            return;
        }
        setTesting(true);
        try {
            await sendTestWebhook();
            push({ type: 'success', message: m['admin.webhooks.config.testSent']() });
        } catch (err) {
            push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() });
        } finally {
            setTesting(false);
        }
    };

    const disableModule = async () => {
        setDisabling(true);
        try {
            await updateWebhookSetting('enabled', false);
            reloadSection();
        } catch (err) {
            setDisabling(false);
            setConfirmDisable(false);
            push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() });
        }
    };

    return (
        <div className="flex flex-col gap-5">
            <div className="grid gap-5 lg:grid-cols-3">
                {/* URL configuration */}
                <div className="lg:col-span-2">
                    <SettingsCard
                        title={m['admin.webhooks.config.urlCard.title']()}
                        description={m['admin.webhooks.config.urlCard.desc']()}
                    >
                        <LabeledField
                            label={m['admin.webhooks.config.urlLabel']()}
                            hint={m['admin.webhooks.config.urlHint']()}
                        >
                            <Input
                                type="url"
                                value={url}
                                onChange={e => setUrl(e.target.value)}
                                placeholder={
                                    configured
                                        ? m['admin.webhooks.config.urlPlaceholderSet']()
                                        : m['admin.webhooks.config.urlPlaceholder']()
                                }
                            />
                        </LabeledField>

                        {configured && (
                            <div className="mt-3 flex items-start gap-2 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-3 py-2.5">
                                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-accent)]" />
                                <div className="min-w-0">
                                    <p className="text-sm font-medium text-[var(--color-accent)]">
                                        {m['admin.webhooks.config.configured']()}
                                    </p>
                                    <p className="mt-0.5 text-xs text-[var(--color-ink-faint)]">
                                        {m['admin.webhooks.config.configuredHint']()}
                                    </p>
                                </div>
                            </div>
                        )}

                        <div className="mt-4 flex items-center justify-between gap-3">
                            <span className="text-xs text-[var(--color-ink-faint)]">
                                {m['admin.webhooks.config.saveHint']()}
                            </span>
                            <Button size="sm" onClick={saveUrl} disabled={saving || url.trim().length === 0}>
                                {saving ? m['common.states.saving']() : m['admin.webhooks.config.save']()}
                            </Button>
                        </div>
                    </SettingsCard>
                </div>

                {/* Quick actions */}
                <div className="flex flex-col gap-5">
                    <SettingsCard title={m['admin.webhooks.config.actions.title']()}>
                        <div className="flex flex-col gap-2.5">
                            <Button
                                variant="outline"
                                onClick={test}
                                disabled={testing || !configured}
                                className="w-full"
                            >
                                <Send className="h-4 w-4" />
                                {testing
                                    ? m['admin.webhooks.config.actions.testing']()
                                    : m['admin.webhooks.config.actions.test']()}
                            </Button>
                            <Button
                                variant="danger"
                                onClick={() => setConfirmDisable(true)}
                                className="w-full"
                            >
                                <PowerOff className="h-4 w-4" />
                                {m['admin.webhooks.config.actions.disableModule']()}
                            </Button>
                        </div>
                    </SettingsCard>

                    <div className="rounded-[var(--radius-card)] border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 p-4">
                        <div className="mb-1.5 flex items-center gap-2">
                            <AlertTriangle className="h-4 w-4 text-[var(--color-warning)]" />
                            <span className="text-sm font-medium text-[var(--color-warning)]">
                                {m['admin.webhooks.config.guide.title']()}
                            </span>
                        </div>
                        <p className="text-xs leading-relaxed text-[var(--color-ink-muted)]">
                            {m['admin.webhooks.config.guide.body']()}
                        </p>
                    </div>
                </div>
            </div>

            {/* Event format */}
            <SettingsCard
                title={m['admin.webhooks.config.format.title']()}
                description={m['admin.webhooks.config.format.desc']()}
            >
                <div className="flex items-center gap-2 border-b border-[var(--color-border)] pb-2 text-xs text-[var(--color-ink-faint)]">
                    <Link2 className="h-3.5 w-3.5" />
                    POST
                </div>
                <pre className="mt-3 overflow-x-auto rounded-xl bg-[var(--color-canvas)] p-4 text-xs leading-relaxed text-[var(--color-ink-muted)]">
                    {SAMPLE_PAYLOAD}
                </pre>
            </SettingsCard>

            <ConfirmDialog
                open={confirmDisable}
                onClose={() => setConfirmDisable(false)}
                title={m['admin.webhooks.config.disableConfirm.title']()}
                body={m['admin.webhooks.config.disableConfirm.body']()}
                confirmLabel={m['admin.webhooks.config.actions.disableModule']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={disabling}
                onConfirm={disableModule}
            />
        </div>
    );
}

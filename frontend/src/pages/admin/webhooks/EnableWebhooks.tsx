import { useState } from 'react';
import { abs } from '@/lib/base';
import { m } from '@/i18n/messages';
import { Webhook } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { updateWebhookSetting } from '@/api/webhooks';

// After enabling the module the Everest bootstrap must be re-read, so we
// hard-navigate back to the section (same approach the Auth module uses).
function reloadSection() {
    window.location.assign(abs('/admin/webhooks'));
}

// Feature-intro gate shown while the webhook module is disabled. Enabling flips
// `settings::modules:webhooks:enabled` and reloads so the management UI mounts.
export default function EnableWebhooks() {
    const push = useFlashes(s => s.push);
    const [busy, setBusy] = useState(false);

    const enable = async () => {
        setBusy(true);
        try {
            await updateWebhookSetting('enabled', true);
            reloadSection();
        } catch (err) {
            setBusy(false);
            push({ type: 'error', message: firstError(err) ?? m['common.states.genericError']() });
        }
    };

    return (
        <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70 px-8 py-14 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-[var(--brand-soft)]">
                <Webhook className="h-8 w-8 text-[var(--brand)]" />
            </div>
            <div className="flex flex-col gap-2">
                <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
                    {m['admin.webhooks.enable.title']()}
                </h1>
                <p className="text-sm leading-relaxed text-[var(--color-ink-muted)]">
                    {m['admin.webhooks.enable.body']()}
                </p>
            </div>
            <Button onClick={enable} disabled={busy}>
                {busy ? m['common.states.saving']() : m['admin.webhooks.enable.action']()}
            </Button>
        </div>
    );
}

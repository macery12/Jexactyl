import { m } from '@/i18n';
import { useState } from 'react';
import { Send } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Spinner, FullPageSpinner } from '@/components/ui/Spinner';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';
import { sendTestEmail, type EmailResponse } from '@/api/email';
import { useEmailSettings } from '../useEmailSettings';
import { SettingsCard, LabeledField } from '../parts';
import { TestResultBanner } from './TestResultBanner';

// Testing: send a real delivery test through the active transport so admins can
// verify end-to-end delivery and inbox placement.
export default function TestingPage() {
    const { settings, isLoading } = useEmailSettings();
    const push = useFlashes(s => s.push);

    const [recipient, setRecipient] = useState('');
    const [sending, setSending] = useState(false);
    const [result, setResult] = useState<EmailResponse | null>(null);

    if (isLoading || !settings) return <FullPageSpinner />;

    const send = () => {
        if (!recipient.trim()) {
            push({ type: 'error', message: m['admin.email.testing.recipientRequired']() });
            return;
        }
        setSending(true);
        sendTestEmail(recipient.trim())
            .then(setResult)
            .catch(err => push({ type: 'error', message: firstError(err) ?? m['admin.email.test.failed']() }))
            .finally(() => setSending(false));
    };

    const tips = [
        m['admin.email.testing.tip1'](),
        m['admin.email.testing.tip2'](),
        m['admin.email.testing.tip3'](),
        m['admin.email.testing.tip4'](),
    ];

    return (
        <div className="flex flex-col gap-5">
            <SettingsCard
                title={m['admin.email.testing.title']()}
                description={m['admin.email.testing.desc']({ transport: settings.transport === 'smtp' ? m['admin.email.overview.smtp']() : m['admin.email.overview.resend']() })}
            >
                <LabeledField label={m['admin.email.testing.recipient']()}>
                    <div className="flex flex-col gap-3 sm:flex-row">
                        <Input
                            type="email"
                            value={recipient}
                            onChange={e => setRecipient(e.target.value)}
                            placeholder="recipient@example.com"
                            className="sm:flex-1"
                        />
                        <Button onClick={send} disabled={sending || !recipient.trim()} className="sm:w-auto">
                            {sending ? <Spinner className="h-4 w-4" /> : <Send className="h-4 w-4" />}
                            {m['admin.email.testing.send']()}
                        </Button>
                    </div>
                </LabeledField>
                {result && <TestResultBanner result={result} />}
            </SettingsCard>

            <SettingsCard title={m['admin.email.testing.tipsTitle']()}>
                <ul className="list-disc space-y-1.5 pl-5 text-sm text-[var(--color-ink-muted)]">
                    {tips.map(tip => (
                        <li key={tip}>{tip}</li>
                    ))}
                </ul>
            </SettingsCard>
        </div>
    );
}

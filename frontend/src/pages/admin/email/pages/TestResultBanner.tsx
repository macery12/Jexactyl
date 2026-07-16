import { m, td } from '@/i18n';
import { cn } from '@/lib/cn';
import type { EmailResponse } from '@/api/email';
import { getStatusPresentation, type EmailTone } from '../status';

// Result banner for a connection check / delivery test. Tone-driven via theme
// tokens; resolves the human message from the API response.
export function TestResultBanner({ result }: { result: EmailResponse }) {
    const status = result.status ?? (result.success ? 'sent' : 'failed');
    const { tone, labelKey } = getStatusPresentation(status);
    const transport = (result.transport ?? result.provider ?? '').toUpperCase();
    const message =
        typeof result.error === 'string'
            ? result.error
            : result.error?.message ?? (result.success ? m['admin.email.test.ok']() : m['admin.email.test.failed']());
    const code = typeof result.error === 'object' ? result.error?.code : undefined;
    const when = result.tested_at ?? result.sent_at;

    return (
        <div className={cn('mt-3 rounded-xl border p-3 text-sm', wash[tone])}>
            <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">
                    {td(`admin.${labelKey}`)}
                    {transport && ` — ${transport}`}
                </span>
                {when && (
                    <span className="text-xs text-[var(--color-ink-faint)]">{new Date(when).toLocaleString()}</span>
                )}
            </div>
            <p className="mt-1 text-[var(--color-ink)]">{message}</p>
            {code && <p className="mt-0.5 text-xs text-[var(--color-ink-faint)]">{m['admin.email.test.code']({ code })}</p>}
        </div>
    );
}

const wash: Record<EmailTone, string> = {
    success: 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10',
    warning: 'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10',
    danger: 'border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10',
    neutral: 'border-[var(--color-border-strong)] bg-[var(--color-surface-2)]/40',
};

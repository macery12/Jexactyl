import { Ban, CheckCircle2, Clock, Hourglass, XCircle, type LucideIcon } from 'lucide-react';

// Visual presentation for an email status. Tone maps onto the theme tokens
// (no hardcoded colors) via `toneClasses` below. `labelKey` resolves against
// the admin `email.status.*` catalog so the chips stay translatable.
export type EmailTone = 'success' | 'danger' | 'warning' | 'neutral';

interface StatusPresentation {
    labelKey: string;
    tone: EmailTone;
    icon: LucideIcon;
}

const PRESENTATIONS: Record<string, StatusPresentation> = {
    queued: { labelKey: 'email.status.queued', tone: 'neutral', icon: Hourglass },
    sending: { labelKey: 'email.status.sending', tone: 'warning', icon: Clock },
    sent: { labelKey: 'email.status.sent', tone: 'success', icon: CheckCircle2 },
    deferred: { labelKey: 'email.status.deferred', tone: 'warning', icon: Clock },
    skipped: { labelKey: 'email.status.skipped', tone: 'neutral', icon: Ban },
    failed: { labelKey: 'email.status.failed', tone: 'danger', icon: XCircle },
};

export function getStatusPresentation(status?: string | null): StatusPresentation {
    if (!status) return PRESENTATIONS.failed!;
    return PRESENTATIONS[status] ?? { labelKey: 'email.status.unknown', tone: 'neutral', icon: Hourglass };
}

// Theme-token chip classes per tone. Backgrounds use a translucent wash of the
// semantic token so the chip reads against any surface.
export const toneChip: Record<EmailTone, string> = {
    success: 'bg-[var(--color-accent)]/12 text-[var(--color-accent)]',
    warning: 'bg-[var(--color-warning)]/12 text-[var(--color-warning)]',
    danger: 'bg-[var(--color-danger)]/12 text-[var(--color-danger)]',
    neutral: 'bg-[var(--color-surface-2)] text-[var(--color-ink-muted)]',
};

import { faBan, faCheckCircle, faClock, faHourglassHalf, faTimesCircle } from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core';

export type EmailStatusTone = 'success' | 'danger' | 'warning' | 'neutral';

type EmailStatusPresentation = {
    label: string;
    tone: EmailStatusTone;
    icon: IconDefinition;
};

const EMAIL_STATUS_PRESENTATIONS: Record<string, EmailStatusPresentation> = {
    queued: {
        label: 'QUEUED',
        tone: 'neutral',
        icon: faHourglassHalf,
    },
    sending: {
        label: 'SENDING',
        tone: 'warning',
        icon: faClock,
    },
    sent: {
        label: 'SENT',
        tone: 'success',
        icon: faCheckCircle,
    },
    deferred: {
        label: 'DEFERRED',
        tone: 'warning',
        icon: faClock,
    },
    skipped: {
        label: 'SKIPPED',
        tone: 'neutral',
        icon: faBan,
    },
    failed: {
        label: 'FAILED',
        tone: 'danger',
        icon: faTimesCircle,
    },
};

export const getEmailStatusPresentation = (status?: string | null): EmailStatusPresentation => {
    if (!status) {
        return EMAIL_STATUS_PRESENTATIONS.failed!;
    }

    return (
        EMAIL_STATUS_PRESENTATIONS[status] ?? {
            label: status.toUpperCase(),
            tone: 'neutral',
            icon: faHourglassHalf,
        }
    );
};

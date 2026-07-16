import type { EmailResponse, EmailTransport } from '@/api/routes/admin/email';

export const getConnectionCheckButtonLabel = (provider: EmailTransport): string =>
    provider === 'smtp' ? 'Check SMTP Connection' : 'Check Resend Connection';

export const formatTestFlowDate = (value?: string): string => (value ? new Date(value).toLocaleString() : '');

export const getConnectionCheckSuccessMessage = (response: EmailResponse): string =>
    response.tested_at
        ? `Connection check successful (${formatTestFlowDate(response.tested_at)})`
        : 'Connection check successful';

export const getDeliveryTestDescription = (provider: EmailTransport): string =>
    `Sends a real email to the recipient using the active provider (${provider.toUpperCase()}).`;

export const getDeliveryTestSuccessMessage = (response: EmailResponse, fallbackProvider: EmailTransport): string => {
    const provider = response.provider || fallbackProvider;
    const recipient = response.recipient;

    if (recipient) {
        return `Delivery test sent to ${recipient} via ${provider.toUpperCase()}`;
    }

    return `Delivery test sent via ${provider.toUpperCase()}`;
};

export const getEmailResponseTimestamp = (response: EmailResponse): string =>
    response.sent_at || response.tested_at || '';

export const getFailedDeliveryFollowup = (
    provider?: string | null,
): {
    title: string;
    message: string;
} | null => {
    if (provider === 'resend') {
        return {
            title: 'Resend',
            message:
                'Resend for failed deliveries is temporarily unavailable because the original template data needed to rebuild the email is not stored with the delivery record yet.',
        };
    }

    if (provider === 'smtp') {
        return {
            title: 'SMTP',
            message:
                'SMTP retries for failed deliveries are not available from the activity view yet. Review the failure details and your SMTP configuration before retrying manually.',
        };
    }

    return null;
};

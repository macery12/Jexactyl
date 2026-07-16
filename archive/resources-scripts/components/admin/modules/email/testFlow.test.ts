import { describe, expect, it } from 'vitest';
import {
    getConnectionCheckButtonLabel,
    getConnectionCheckSuccessMessage,
    getDeliveryTestDescription,
    getDeliveryTestSuccessMessage,
    getEmailResponseTimestamp,
    getFailedDeliveryFollowup,
} from './testFlow';

describe('email test flow copy', () => {
    it('distinguishes provider connection checks from delivery tests', () => {
        expect(getConnectionCheckButtonLabel('smtp')).toBe('Check SMTP Connection');
        expect(getConnectionCheckButtonLabel('resend')).toBe('Check Resend Connection');
        expect(getDeliveryTestDescription('smtp')).toBe(
            'Sends a real email to the recipient using the active provider (SMTP).',
        );
    });

    it('builds delivery success messages with recipient context when available', () => {
        expect(
            getDeliveryTestSuccessMessage(
                { success: true, provider: 'resend', recipient: 'admin@example.com' },
                'smtp',
            ),
        ).toBe('Delivery test sent to admin@example.com via RESEND');
    });

    it('prefers the send timestamp when a real delivery test succeeds', () => {
        expect(
            getEmailResponseTimestamp({
                success: true,
                sent_at: '2026-03-22T12:00:00Z',
                tested_at: '2026-03-22T11:00:00Z',
            }),
        ).toBe('2026-03-22T12:00:00Z');
    });

    it('formats connection check success messages with timestamps', () => {
        const message = getConnectionCheckSuccessMessage({
            success: true,
            tested_at: '2026-03-22T12:00:00Z',
        });

        expect(message).toContain('Connection check successful');
        expect(message).toContain('2026');
    });

    it('returns provider-specific failed delivery follow-up copy', () => {
        expect(getFailedDeliveryFollowup('resend')).toEqual({
            title: 'Resend',
            message:
                'Resend for failed deliveries is temporarily unavailable because the original template data needed to rebuild the email is not stored with the delivery record yet.',
        });

        expect(getFailedDeliveryFollowup('smtp')).toEqual({
            title: 'SMTP',
            message:
                'SMTP retries for failed deliveries are not available from the activity view yet. Review the failure details and your SMTP configuration before retrying manually.',
        });

        expect(getFailedDeliveryFollowup('mailgun')).toBeNull();
        expect(getFailedDeliveryFollowup()).toBeNull();
    });
});

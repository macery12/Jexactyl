import { useEffect, useState } from 'react';
import useFlash from '@/plugins/useFlash';
import http from '@/api/http';
import { sendEmailVerification } from '@/api/routes/account/email-verification';
import { useStoreActions } from '@/state/hooks';

const STORAGE_KEY = 'emailVerificationCooldown';
// Cooldown aligns with backend throttle (RouteServiceProvider::configureRateLimiting -> 'email-verification'): 1 request per minute.
const COOLDOWN_MS = 60 * 1000;

const fallback = () => ({
    resend: () => {},
    cooldown: 0,
    isCoolingDown: false,
    resetCooldown: () => {},
    resendLabel: 'Resend verification email',
    refreshUser: () => {},
});

export const useEmailVerification = (enabled = true) => {
    try {
        if (!enabled) {
            return fallback();
        }

        const { addFlash, clearAndAddHttpError, clearFlashes } = useFlash();
        const { updateUserData } = useStoreActions(actions => actions.user);
        const storedCooldown = localStorage.getItem(STORAGE_KEY);
        const initialCooldownEnd = storedCooldown ? Number(storedCooldown) : 0;
        const [cooldownEnd, setCooldownEnd] = useState<number>(initialCooldownEnd);
        const [cooldown, setCooldown] = useState(() =>
            Math.max(0, Math.ceil(Math.max(0, initialCooldownEnd - Date.now()) / 1000)),
        );

        useEffect(() => {
            if (cooldownEnd < Date.now()) {
                setCooldown(0);
                return;
            }

            const update = () => {
                setCooldown(Math.max(0, Math.ceil((cooldownEnd - Date.now()) / 1000)));
            };

            update();
            const id = setInterval(update, 1000);
            return () => clearInterval(id);
        }, [cooldownEnd]);

        const isCoolingDown = cooldown > 0;
        const resendLabel = isCoolingDown ? `Resend in ${cooldown}s` : 'Resend verification email';

        const triggerResend = async () => {
            try {
                clearFlashes('account:verification');
                await sendEmailVerification();
                const end = Date.now() + COOLDOWN_MS;
                setCooldownEnd(end);
                localStorage.setItem(STORAGE_KEY, String(end));
                addFlash({
                    key: 'account:verification',
                    type: 'success',
                    title: 'Verification Sent',
                    message: 'Check your inbox for the verification email.',
                });
            } catch (error) {
                clearAndAddHttpError({ key: 'account:verification', error });
            }
        };

        const refreshUser = async () => {
            try {
                const { data } = await http.get('/api/client/account');
                const attributes = data?.attributes ?? data?.data?.attributes;

                if (!attributes) {
                    throw new Error('Unexpected account response format when refreshing verification status.');
                }

                updateUserData({
                    email: attributes.email,
                    emailVerified: Boolean(attributes.email_verified),
                    emailVerifiedAt: attributes.email_verified_at ? new Date(attributes.email_verified_at) : undefined,
                });
            } catch (error) {
                clearAndAddHttpError({ key: 'account:verification', error });
            }
        };

        const resetCooldown = () => {
            setCooldownEnd(0);
            localStorage.removeItem(STORAGE_KEY);
        };

        return {
            resend: triggerResend,
            cooldown,
            isCoolingDown,
            resetCooldown,
            resendLabel,
            refreshUser,
        };
    } catch (e) {
        console.error('useEmailVerification failed, using safe fallback', e);
        return fallback();
    }
};

import PageContentBlock from '@/elements/PageContentBlock';
import { Alert } from '@/elements/alert';
import { Button } from '@/elements/button';
import { useEmailVerification } from '@/hooks/useEmailVerification';
import { useStoreState } from '@/state/hooks';
import FlashMessageRender from '@/elements/FlashMessageRender';
import React from 'react';
import {
    EMAIL_VERIFICATION_ALERT_MESSAGE,
    EMAIL_VERIFICATION_ALERT_TITLE,
    EMAIL_VERIFICATION_AREA_LABELS,
} from '@/constants/emailVerification';
import { type VerificationArea } from '@/state/everest';

type Props = {
    children: React.ReactNode;
    area?: VerificationArea | null;
};

const EmailVerificationGate = ({ children, area }: Props) => {
    const user = useStoreState(state => state.user.data!);
    const emailEnabled = useStoreState(state => {
        const email = state.everest.data?.email;
        const resend = email?.resend;
        return Boolean(email?.enabled ?? (typeof resend !== 'boolean' ? resend?.enabled : undefined) ?? resend);
    });
    const verification = useEmailVerification(emailEnabled) || {};
    const {
        resend = () => {},
        isCoolingDown = false,
        resendLabel = 'Resend verification email',
        refreshUser = () => {},
    } = verification as ReturnType<typeof useEmailVerification>;
    const areaLabel = area ? EMAIL_VERIFICATION_AREA_LABELS[area] : null;

    if (!emailEnabled || user.emailVerified) {
        return <>{children}</>;
    }

    return (
        <PageContentBlock title={EMAIL_VERIFICATION_ALERT_TITLE}>
            <FlashMessageRender byKey={'account:verification'} />
            <Alert type="warning">
                <div className="space-y-3">
                    <div>
                        <strong className="block text-lg">{EMAIL_VERIFICATION_ALERT_TITLE}</strong>
                        <p className="text-sm text-yellow-50">
                            {EMAIL_VERIFICATION_ALERT_MESSAGE}
                            {areaLabel ? ` (${areaLabel})` : null}
                        </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button size={Button.Sizes.Small} disabled={isCoolingDown} onClick={() => void resend()}>
                            {resendLabel}
                        </Button>
                        <Button size={Button.Sizes.Small} onClick={() => void refreshUser()}>
                            I already verified
                        </Button>
                    </div>
                </div>
            </Alert>
        </PageContentBlock>
    );
};

export default EmailVerificationGate;

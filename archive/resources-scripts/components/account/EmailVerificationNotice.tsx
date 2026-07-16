import { Alert } from '@/elements/alert';
import { Button } from '@/elements/button';
import { useEmailVerification } from '@/hooks/useEmailVerification';
import { useStoreState } from '@/state/hooks';
import FlashMessageRender from '@/elements/FlashMessageRender';
import tw from 'twin.macro';
import { EMAIL_VERIFICATION_ALERT_MESSAGE, EMAIL_VERIFICATION_ALERT_TITLE } from '@/constants/emailVerification';

interface Props {
    className?: string;
}

const EmailVerificationNotice = ({ className }: Props) => {
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

    if (!emailEnabled || user.emailVerified) {
        return null;
    }

    return (
        <div className={className}>
            <FlashMessageRender byKey={'account:verification'} />
            <Alert type="warning" className={'mb-4'}>
                <div css={tw`flex flex-col gap-3`}>
                    <div>
                        <strong className={'block text-lg'}>{EMAIL_VERIFICATION_ALERT_TITLE}</strong>
                        <span className={'text-sm text-yellow-50'}>{EMAIL_VERIFICATION_ALERT_MESSAGE}</span>
                    </div>
                    <div css={tw`flex flex-wrap gap-2`}>
                        <Button size={Button.Sizes.Small} disabled={isCoolingDown} onClick={() => void resend()}>
                            {resendLabel}
                        </Button>
                        <Button size={Button.Sizes.Small} onClick={() => void refreshUser()}>
                            I already verified
                        </Button>
                    </div>
                </div>
            </Alert>
        </div>
    );
};

export default EmailVerificationNotice;

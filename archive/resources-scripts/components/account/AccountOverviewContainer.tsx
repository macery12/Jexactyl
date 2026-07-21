import ContentBox from '@/elements/ContentBox';
import UpdatePasswordForm from '@account/forms/UpdatePasswordForm';
import UpdateEmailAddressForm from '@account/forms/UpdateEmailAddressForm';
import ConfigureTwoFactorForm from '@account/forms/ConfigureTwoFactorForm';
import DiscordLinkForm from '@account/forms/DiscordLinkForm';
import PageContentBlock from '@/elements/PageContentBlock';
import tw from 'twin.macro';
import { breakpoint } from '@/assets/theme';
import styled from 'styled-components';
import MessageBox from '@/elements/MessageBox';
import { useLocation } from 'react-router-dom';
import ScopedAlert from '@/components/account/ScopedAlert';
import EmailVerificationNotice from '@account/EmailVerificationNotice';
import FlashMessageRender from '@/elements/FlashMessageRender';
import Pill from '@/elements/Pill';
import { useStoreState } from '@/state/hooks';
import { useEffect, useState } from 'react';
import { getBillingProfile, type BillingProfile } from '@/api/routes/account/billing/billingProfile';
import BillingAddressModal from '@account/billing/BillingAddressModal';
import { Button } from '@/elements/button';

const Container = styled.div`
    ${tw`flex flex-wrap`};

    & > div {
        ${tw`w-full`};

        ${breakpoint('sm')`
      width: calc(50% - 1rem);
    `}

        ${breakpoint('md')`
      ${tw`w-auto flex-1`};
    `}
    }
`;

export default () => {
    const { state } = useLocation();
    const user = useStoreState(s => s.user.data!);
    const emailEnabled = useStoreState(s => {
        const email = s.everest.data?.email;
        const resend = email?.resend;
        return Boolean(email?.enabled ?? (typeof resend !== 'boolean' ? resend?.enabled : undefined) ?? resend);
    });
    const discordEnabled = useStoreState(s => Boolean(s.everest.data?.auth?.modules?.discord?.enabled));

    const [billingProfile, setBillingProfile] = useState<BillingProfile | null>(null);
    const [billingLoaded, setBillingLoaded] = useState(false);
    const [billingModalOpen, setBillingModalOpen] = useState(false);

    useEffect(() => {
        getBillingProfile()
            .then(profile => setBillingProfile(profile))
            .catch(() => setBillingProfile(null))
            .finally(() => setBillingLoaded(true));
    }, []);

    const handleBillingSaved = (profile: BillingProfile) => {
        setBillingProfile(profile);
        setBillingModalOpen(false);
    };

    return (
        <PageContentBlock title="Account Overview" header description={'Update your email, password, or setup 2-FA.'}>
            <ScopedAlert scope="account" position="top-center" />
            {emailEnabled && <EmailVerificationNotice />}
            {state?.twoFactorRedirect && (
                <MessageBox title="2-Factor Required" type="error">
                    Your account must have two-factor authentication enabled in order to continue.
                </MessageBox>
            )}

            <Container css={[tw`lg:grid lg:grid-cols-3 mb-10`, state?.twoFactorRedirect ? tw`mt-4` : tw`mt-10`]}>
                <ContentBox title="Update Password" showFlashes="account:password">
                    <UpdatePasswordForm />
                </ContentBox>

                <ContentBox css={tw`mt-8 sm:mt-0 sm:ml-8`} title="Update Email Address" showFlashes="account:email">
                    {emailEnabled && (
                        <div className="mb-4 flex items-center justify-between">
                            <span className="text-sm text-gray-300">Status</span>
                            <Pill type={user.emailVerified ? 'success' : 'warn'}>
                                {user.emailVerified ? 'Verified' : 'Not Verified'}
                            </Pill>
                        </div>
                    )}
                    <UpdateEmailAddressForm />
                </ContentBox>

                <ContentBox css={tw`md:ml-8 mt-8 md:mt-0`} title="Two-Step Verification">
                    <ConfigureTwoFactorForm />
                </ContentBox>
            </Container>

            {/* Billing Information */}
            {billingLoaded && (
                <div css={tw`mb-10 lg:w-1/3`}>
                    <ContentBox title="Billing Information">
                        {billingProfile ? (
                            <div className={'space-y-1 text-sm text-neutral-300'}>
                                <p className={'font-medium text-neutral-100'}>
                                    {billingProfile.first_name} {billingProfile.last_name}
                                </p>
                                <p>{billingProfile.address_line1}</p>
                                {billingProfile.address_line2 && <p>{billingProfile.address_line2}</p>}
                                <p>
                                    {billingProfile.city}
                                    {billingProfile.state ? `, ${billingProfile.state}` : ''}{' '}
                                    {billingProfile.postal_code}
                                </p>
                                <p>{billingProfile.country}</p>
                                {billingProfile.phone && (
                                    <p className={'mt-1 text-neutral-400'}>{billingProfile.phone}</p>
                                )}
                            </div>
                        ) : (
                            <p className={'text-sm text-neutral-400'}>
                                No billing information set. Add your address to have it included on invoices.
                            </p>
                        )}
                        <div className={'mt-4'}>
                            <Button size={Button.Sizes.Small} onClick={() => setBillingModalOpen(true)}>
                                {billingProfile ? 'Edit Billing Info' : 'Add Billing Info'}
                            </Button>
                        </div>
                    </ContentBox>
                </div>
            )}

            {discordEnabled && (
                <div css={tw`mb-10`}>
                    <FlashMessageRender byKey={'account:discord'} css={tw`mb-4`} />
                    <div css={tw`lg:w-1/3`}>
                        <ContentBox title="Connected Accounts">
                            <DiscordLinkForm />
                        </ContentBox>
                    </div>
                </div>
            )}

            <BillingAddressModal
                open={billingModalOpen}
                onClose={() => setBillingModalOpen(false)}
                existing={billingProfile}
                onSaved={handleBillingSaved}
            />
        </PageContentBlock>
    );
};



import { useState } from 'react';
import AdminBox from '@/elements/AdminBox';
import { Button } from '@/elements/button';
import { faKey } from '@fortawesome/free-solid-svg-icons';
import { faPaypal, faStripe } from '@fortawesome/free-brands-svg-icons';
import { useStoreState, useStoreActions } from '@/state/hooks';
import { deleteStripeKeys, updateSettings } from '@/api/routes/admin/billing';
import SetupStripeKeys from '../guides/SetupStripeKeys';
import SetupPayPal from '../guides/SetupPayPal';
import SetupLink from '../guides/SetupLink';

export default () => {
    const settings = useStoreState(s => s.everest.data!.billing);
    const updateEverest = useStoreActions(s => s.everest.updateEverest);
    const [stripeKeysOpen, setStripeKeysOpen] = useState(false);
    const [paypalOpen, setPaypalOpen] = useState(false);
    const [linkOpen, setLinkOpen] = useState(false);

    const submit = async (key: string, value: boolean | string) => {
        await updateSettings(key, value).then(() => {
            updateEverest({ billing: { ...settings, [key]: value } });
        });
    };

    const onDeleteKeys = () => {
        deleteStripeKeys()
            .then(() => window.location.reload())
            .catch(error => console.log(error));
    };

    return (
        <div className={'grid gap-4 lg:grid-cols-3'}>
            <SetupStripeKeys open={stripeKeysOpen} onClose={() => setStripeKeysOpen(false)} />
            {paypalOpen && <SetupPayPal setOpen={val => setPaypalOpen(val !== 'none')} />}
            {linkOpen && <SetupLink setOpen={val => setLinkOpen(val !== 'none')} />}

            {!settings.keys.publishable || !settings.keys.secret ? (
                <AdminBox title={'Input Stripe API Keys'} icon={faKey}>
                    Stripe is enabled but API keys are not configured. Without Stripe API authentication, your billing
                    system will not work. Customers may proceed to the checkout area but will be met with errors unless
                    you add valid API keys which can be obtained through the Stripe dashboard.
                    <div className={'mt-3 text-right'}>
                        <Button onClick={() => setStripeKeysOpen(true)}>Add API keys</Button>
                    </div>
                </AdminBox>
            ) : (
                <AdminBox title={'Manage Stripe API keys'} icon={faKey}>
                    Your Stripe API keys are configured and ready to process payments. You can update your keys or
                    delete them if needed.
                    <div className={'mt-3 flex justify-end gap-2'}>
                        <Button onClick={() => setStripeKeysOpen(true)}>Update API keys</Button>
                        <Button.Danger onClick={onDeleteKeys}>Delete API keys</Button.Danger>
                    </div>
                </AdminBox>
            )}

            <AdminBox title={'Add PayPal integration'} icon={faPaypal}>
                Adding PayPal to M12Labs allows users to purchase products via another channel, improving order success
                rate and global payment availability. PayPal integration works through Stripe.
                <p className={'mt-2 text-gray-400'}>
                    PayPal module is currently{' '}
                    <span className={settings.paypal ? 'text-green-500' : 'text-red-500'}>
                        {settings.paypal ? 'enabled' : 'disabled'}
                    </span>
                    .
                </p>
                <div className={'mt-2 text-right'}>
                    {settings.paypal && (
                        <Button.Text
                            className={'mr-2'}
                            onClick={() => setPaypalOpen(true)}
                            variant={Button.Variants.Secondary}
                        >
                            Setup Instructions
                        </Button.Text>
                    )}
                    <Button.Text onClick={() => submit('paypal', !settings.paypal)}>
                        {settings.paypal ? 'Disable' : 'Enable'}
                    </Button.Text>
                </div>
            </AdminBox>

            <AdminBox title={'Add Link integration'} icon={faStripe}>
                Adding Link to M12Labs allows users to purchase products via another channel, improving order success
                rate and global payment availability. Link is Stripe&apos;s one-click payment system.
                <p className={'mt-2 text-gray-400'}>
                    Link module is currently{' '}
                    <span className={settings.link ? 'text-green-500' : 'text-red-500'}>
                        {settings.link ? 'enabled' : 'disabled'}
                    </span>
                    .
                </p>
                <div className={'mt-2 text-right'}>
                    {settings.link && (
                        <Button.Text
                            className={'mr-2'}
                            onClick={() => setLinkOpen(true)}
                            variant={Button.Variants.Secondary}
                        >
                            Setup Instructions
                        </Button.Text>
                    )}
                    <Button.Text onClick={() => submit('link', !settings.link)}>
                        {settings.link ? 'Disable' : 'Enable'}
                    </Button.Text>
                </div>
            </AdminBox>
        </div>
    );
};

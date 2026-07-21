import Input from '@/elements/Input';
import Select from '@/elements/Select';
import { Dialog } from '@/elements/dialog';
import { faExclamationTriangle, faCheckCircle, faInfoCircle } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import Tooltip from '@/elements/tooltip/Tooltip';
import { useState } from 'react';
import { Button } from '@/elements/button';
import { updateSettings } from '@/api/routes/admin/billing';

interface PayPalKeys {
    clientId?: string;
    clientSecret?: string;
    mode?: 'sandbox' | 'live';
}

export default ({ open, onClose }: { open: boolean; onClose: () => void }) => {
    const [data, setData] = useState<PayPalKeys>({ mode: 'sandbox' });

    const submit = async () => {
        if (!data.clientId || !data.clientSecret || !data.mode) return;

        await updateSettings('paypal_standalone:client_id', data.clientId);
        await updateSettings('paypal_standalone:client_secret', data.clientSecret);
        await updateSettings('paypal_standalone:mode', data.mode);
        window.location.reload();
    };

    const isValid = () => {
        return (
            data.clientId &&
            data.clientSecret &&
            data.mode &&
            data.clientId.length > 10 &&
            data.clientSecret.length > 10
        );
    };

    return (
        <Dialog open={open} onClose={onClose} title={'Configure PayPal API Credentials'}>
            <div className={'mb-4 rounded-lg bg-black/50 p-3'}>
                <p className={'font-semibold text-gray-200'}>
                    <FontAwesomeIcon icon={faInfoCircle} className={'mr-2 text-blue-400'} />
                    PayPal REST API Credentials
                </p>
                <p className={'text-sm text-gray-400'}>
                    You need both a Client ID and Client Secret from your PayPal Developer account to process payments.
                </p>
            </div>

            <div className={'mb-4 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3'}>
                <p className={'text-sm text-yellow-300'}>
                    <FontAwesomeIcon icon={faExclamationTriangle} className={'mr-2'} />
                    <strong>Important:</strong> Make sure to create credentials for the REST API (not the classic API).
                    Use sandbox credentials for testing and live credentials for production.
                </p>
            </div>

            <p className={'mb-4'}>
                Before you can use the PayPal API, you must provide M12Labs with API credentials. Visit the PayPal
                Developer Dashboard
                <a
                    target={'_blank'}
                    rel={'noreferrer'}
                    className={'mx-1 text-blue-300'}
                    href={'https://developer.paypal.com/dashboard/applications/live'}
                >
                    here
                </a>
                to create an app and obtain your Client ID and Client Secret, then paste them below.
            </p>

            <div className={'mb-4'}>
                <label className={'mb-2 block text-sm font-medium text-gray-300'}>Environment Mode</label>
                <Select
                    defaultValue={data.mode || 'sandbox'}
                    onChange={e => setData({ ...data, mode: e.currentTarget.value as 'sandbox' | 'live' })}
                >
                    <option value="sandbox">Sandbox (Testing)</option>
                    <option value="live">Live (Production)</option>
                </Select>
                <p className={'mt-1 text-xs text-gray-400'}>
                    Use sandbox for testing, switch to live when ready for production
                </p>
            </div>

            <div className={'relative mt-4'}>
                <label className={'mb-2 block text-sm font-medium text-gray-300'}>Client ID</label>
                <Input
                    placeholder={'Enter PayPal Client ID here...'}
                    defaultValue={''}
                    onChange={e => setData({ ...data, clientId: e.currentTarget.value })}
                />
                {!data?.clientId || data.clientId.length < 10 ? (
                    <Tooltip placement={'right'} content={'You must enter a valid PayPal Client ID to continue.'}>
                        <FontAwesomeIcon
                            icon={faExclamationTriangle}
                            className={'absolute top-10 right-4 text-yellow-500'}
                        />
                    </Tooltip>
                ) : (
                    <FontAwesomeIcon icon={faCheckCircle} className={'absolute top-10 right-4 text-green-500'} />
                )}
            </div>

            <div className={'relative mt-4'}>
                <label className={'mb-2 block text-sm font-medium text-gray-300'}>Client Secret</label>
                <Input
                    type={'password'}
                    placeholder={'Enter PayPal Client Secret here...'}
                    defaultValue={''}
                    onChange={e => setData({ ...data, clientSecret: e.currentTarget.value })}
                />
                {!data?.clientSecret || data.clientSecret.length < 10 ? (
                    <Tooltip placement={'right'} content={'You must enter a valid PayPal Client Secret to continue.'}>
                        <FontAwesomeIcon
                            icon={faExclamationTriangle}
                            className={'absolute top-10 right-4 text-yellow-500'}
                        />
                    </Tooltip>
                ) : (
                    <FontAwesomeIcon icon={faCheckCircle} className={'absolute top-10 right-4 text-green-500'} />
                )}
            </div>

            <div className={'mt-6 rounded-lg border border-blue-500/20 bg-blue-500/10 p-3'}>
                <p className={'text-sm text-blue-300'}>
                    <FontAwesomeIcon icon={faInfoCircle} className={'mr-2'} />
                    <strong>Getting Started:</strong> Create a new app in the PayPal Developer Dashboard, then copy the
                    Client ID and Client Secret from the app details page. For sandbox testing, use sandbox credentials.
                    For production, switch to live mode and use live credentials.
                </p>
            </div>

            <div className={'mt-4 rounded-lg border border-yellow-500/20 bg-yellow-500/10 p-3'}>
                <p className={'text-sm font-semibold text-yellow-300'}>
                    <FontAwesomeIcon icon={faExclamationTriangle} className={'mr-2'} />
                    Don&apos;t Forget: Configure Webhooks
                </p>
                <p className={'mt-2 text-xs text-gray-300'}>
                    After saving your credentials, you <strong>must</strong> configure webhooks in PayPal for reliable
                    payment processing:
                </p>
                <ol className={'mt-2 list-inside list-decimal space-y-1 text-xs text-gray-300'}>
                    <li>Go to your app in the PayPal Developer Dashboard</li>
                    <li>Navigate to the &quot;Webhooks&quot; section</li>
                    <li>Copy the webhook URL from the settings page</li>
                    <li>
                        Subscribe to events: <code className={'text-yellow-400'}>CHECKOUT.ORDER.COMPLETED</code> and{' '}
                        <code className={'text-yellow-400'}>PAYMENT.CAPTURE.COMPLETED</code>
                    </li>
                </ol>
            </div>

            <div className={'mt-4 w-full text-right'}>
                <Button onClick={submit} disabled={!isValid()}>
                    Save PayPal Credentials
                </Button>
            </div>
        </Dialog>
    );
};

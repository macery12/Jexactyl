import Input from '@/elements/Input';
import { useStoreState } from '@/state/hooks';
import { Dialog } from '@/elements/dialog';
import { faExclamationTriangle, faCheckCircle, faInfoCircle } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import Tooltip from '@/elements/tooltip/Tooltip';
import { useEffect, useState } from 'react';
import { Button } from '@/elements/button';
import { updateSettings } from '@/api/routes/admin/billing';

interface StripeKeys {
    publishable?: string;
    secret?: string;
}

export default ({ extOpen }: { extOpen?: boolean }) => {
    const [data, setData] = useState<StripeKeys>();
    const [open, setOpen] = useState<boolean>(extOpen ?? false);
    const existingKeys = useStoreState(s => s.everest.data!.billing.keys);

    const submit = async () => {
        if (!data || !data.secret || !data.publishable) return;

        updateSettings('keys:publishable', data.publishable).then(() => {
            updateSettings('keys:secret', data.secret).then(() => {
                window.location.reload();
            });
        });
    };

    const isPublishableKeyValid = () => {
        if (!data?.publishable) return false;
        const key = data.publishable.trim();
        return (key.startsWith('pk_test_') || key.startsWith('pk_live_')) && key.length >= 100 && key.length <= 120;
    };

    const isSecretKeyValid = () => {
        if (!data?.secret) return false;
        const key = data.secret.trim();
        return (key.startsWith('sk_test_') || key.startsWith('sk_live_')) && key.length >= 100 && key.length <= 120;
    };

    const isValid = () => {
        return isPublishableKeyValid() && isSecretKeyValid();
    };

    const getPublishableKeyError = () => {
        if (!data?.publishable) return 'You must enter a Stripe publishable key to continue.';
        const key = data.publishable.trim();
        if (key.startsWith('sk_')) {
            return '⚠️ This looks like a SECRET key! Use your PUBLISHABLE key (pk_test_... or pk_live_...) here.';
        }
        if (!key.startsWith('pk_')) {
            return 'Publishable keys must start with pk_test_ or pk_live_';
        }
        if (key.length < 100 || key.length > 120) {
            return 'Invalid key length. Stripe keys are typically 107-108 characters.';
        }
        return '';
    };

    const getSecretKeyError = () => {
        if (!data?.secret) return 'You must enter a Stripe secret key to continue.';
        const key = data.secret.trim();
        if (key.startsWith('pk_')) {
            return '⚠️ This looks like a PUBLISHABLE key! Use your SECRET key (sk_test_... or sk_live_...) here.';
        }
        if (!key.startsWith('sk_')) {
            return 'Secret keys must start with sk_test_ or sk_live_';
        }
        if (key.length < 100 || key.length > 120) {
            return 'Invalid key length. Stripe keys are typically 107-108 characters.';
        }
        return '';
    };

    useEffect(() => {
        if (existingKeys && !existingKeys.publishable) {
            setOpen(true);
        }
    }, [existingKeys]);

    return (
        <Dialog open={open} onClose={() => setOpen(false)} title={'Configure Stripe API'}>
            <div className={'mb-4 rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3'}>
                <p className={'font-semibold text-yellow-400'}>
                    <FontAwesomeIcon icon={faExclamationTriangle} className={'mr-2'} />
                    Important: Key Types
                </p>
                <ul className={'mt-2 space-y-1 text-sm text-gray-300'}>
                    <li>
                        • <strong className={'text-green-400'}>Publishable Key</strong> (starts with{' '}
                        <code className={'text-green-400'}>pk_test_</code> or{' '}
                        <code className={'text-green-400'}>pk_live_</code>): Safe to expose in your website
                    </li>
                    <li>
                        • <strong className={'text-red-400'}>Secret Key</strong> (starts with{' '}
                        <code className={'text-red-400'}>sk_test_</code> or{' '}
                        <code className={'text-red-400'}>sk_live_</code>): Never share or expose publicly
                    </li>
                </ul>
            </div>
            <div className={'mb-4 rounded-lg bg-black/50 p-3'}>
                <p className={'font-semibold text-gray-200'}>
                    <FontAwesomeIcon icon={faInfoCircle} className={'mr-2 text-blue-400'} />
                    Still setting up?
                </p>
                <p className={'text-sm text-gray-400'}>
                    Feel free to skip this message by closing the dialog and proceed to set up your products and
                    categories. Once you&apos;re ready, head to the Settings tab to input your API key and secret.
                </p>
            </div>
            Before you can use the Stripe API, you must provide M12Labs with API keys to authenticate with Stripe. Visit
            the Stripe dashboard
            <a
                target={'_blank'}
                rel={'noreferrer'}
                className={'mx-1 text-blue-300'}
                href={'https://dashboard.stripe.com/apikeys'}
            >
                here
            </a>
            to obtain your API key and secret key, then paste them here.
            <div className={'relative mt-4'}>
                <label className={'mb-1 block text-sm font-medium text-gray-300'}>
                    Publishable Key <span className={'text-green-400'}>(pk_test_... or pk_live_...)</span>
                </label>
                <Input
                    placeholder={'pk_test_51Ab...'}
                    onChange={e => setData({ ...data, publishable: e.currentTarget.value })}
                />
                {!isPublishableKeyValid() ? (
                    <Tooltip placement={'right'} content={getPublishableKeyError()}>
                        <FontAwesomeIcon
                            icon={faExclamationTriangle}
                            className={'absolute top-2/3 right-4 text-yellow-500'}
                        />
                    </Tooltip>
                ) : (
                    <FontAwesomeIcon icon={faCheckCircle} className={'absolute top-2/3 right-4 text-green-500'} />
                )}
                {data?.publishable && data.publishable.trim().startsWith('sk_') && (
                    <div className={'mt-2 rounded border border-red-500 bg-red-500/10 p-2 text-sm text-red-400'}>
                        ⚠️ <strong>WARNING:</strong> This appears to be a SECRET key! Please use your PUBLISHABLE key
                        here (starts with pk_). Secret keys must never be exposed to clients.
                    </div>
                )}
            </div>
            <div className={'relative mt-4'}>
                <label className={'mb-1 block text-sm font-medium text-gray-300'}>
                    Secret Key <span className={'text-red-400'}>(sk_test_... or sk_live_...)</span>
                </label>
                <Input
                    type={'password'}
                    placeholder={'sk_test_51Ab...'}
                    onChange={e => setData({ ...data, secret: e.currentTarget.value })}
                />
                {!isSecretKeyValid() ? (
                    <Tooltip placement={'right'} content={getSecretKeyError()}>
                        <FontAwesomeIcon
                            icon={faExclamationTriangle}
                            className={'absolute top-2/3 right-4 text-yellow-500'}
                        />
                    </Tooltip>
                ) : (
                    <FontAwesomeIcon icon={faCheckCircle} className={'absolute top-2/3 right-4 text-green-500'} />
                )}
                {data?.secret && data.secret.trim().startsWith('pk_') && (
                    <div className={'mt-2 rounded border border-red-500 bg-red-500/10 p-2 text-sm text-red-400'}>
                        ⚠️ <strong>WARNING:</strong> This appears to be a PUBLISHABLE key! Please use your SECRET key
                        here (starts with sk_).
                    </div>
                )}
            </div>
            <div className={'mt-4 w-full text-right'}>
                <Button onClick={submit} disabled={!isValid()}>
                    Submit
                </Button>
            </div>
        </Dialog>
    );
};

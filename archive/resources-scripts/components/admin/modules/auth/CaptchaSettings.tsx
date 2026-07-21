import Label from '@/elements/Label';
import Select from '@/elements/Select';
import AdminBox from '@/elements/AdminBox';
import { faShieldAlt } from '@fortawesome/free-solid-svg-icons';
import Input from '@/elements/Input';
import useFlash from '@/plugins/useFlash';
import { useStoreState } from '@/state/hooks';
import useStatus from '@/plugins/useStatus';
import { updateModule } from '@/api/routes/admin/auth/module';
import { useState, useEffect } from 'react';

export default () => {
    const { status, setStatus } = useStatus();
    const { clearFlashes, clearAndAddHttpError } = useFlash();
    const settings = useStoreState(state => state.everest.data!.auth.captcha);

    // Local state to track the current provider selection for immediate UI updates
    const [currentProvider, setCurrentProvider] = useState(settings.provider);

    // Sync local state with store state when it changes
    useEffect(() => {
        setCurrentProvider(settings.provider);
    }, [settings.provider]);

    const update = (key: string, value: any) => {
        clearFlashes();
        setStatus('loading');

        // Update local state immediately for provider changes
        if (key === 'provider') {
            setCurrentProvider(value);
        }

        updateModule('captcha', key, value)
            .then(() => setStatus('success'))
            .catch(error => {
                setStatus('error');
                clearAndAddHttpError({ key: 'auth:captcha', error });
            });
    };

    return (
        <AdminBox title={'Captcha Settings'} icon={faShieldAlt} byKey={'auth:captcha'} status={status}>
            <div>
                <Label>Captcha Provider</Label>
                <Select
                    id={'provider'}
                    name={'provider'}
                    onChange={e => update('provider', e.target.value)}
                    autoComplete={'off'}
                >
                    <option value={'disabled'} selected={currentProvider === 'disabled'}>
                        Disabled
                    </option>
                    <option value={'turnstile'} selected={currentProvider === 'turnstile'}>
                        Cloudflare Turnstile
                    </option>
                </Select>
                <p className={'mt-1 text-xs text-gray-400'}>
                    Select the captcha provider to use for authentication forms.
                </p>
            </div>
            {currentProvider === 'turnstile' && (
                <>
                    <div className={'mt-6'}>
                        <Label>Site Key</Label>
                        <Input
                            placeholder={'Cloudflare Turnstile Site Key'}
                            id={'site_key'}
                            type={'text'}
                            name={'site_key'}
                            autoComplete={'off'}
                            defaultValue={settings.site_key}
                            onChange={e => update('site_key', e.target.value)}
                        />
                        <p className={'mt-1 text-xs text-gray-400'}>
                            Your Cloudflare Turnstile site key (visible to users).
                        </p>
                    </div>
                    <div className={'mt-6'}>
                        <Label>Secret Key</Label>
                        <Input
                            placeholder={'Cloudflare Turnstile Secret Key'}
                            id={'secret_key'}
                            type={'password'}
                            name={'secret_key'}
                            autoComplete={'off'}
                            defaultValue={settings.secret_key}
                            onChange={e => update('secret_key', e.target.value)}
                        />
                        <p className={'mt-1 text-xs text-gray-400'}>
                            Your Cloudflare Turnstile secret key (kept private on the server).
                        </p>
                    </div>
                </>
            )}
        </AdminBox>
    );
};

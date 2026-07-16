import useFlash from '@/plugins/useFlash';
import Label from '@/elements/Label';
import Select from '@/elements/Select';
import AdminBox from '@/elements/AdminBox';
import { faUserPlus } from '@fortawesome/free-solid-svg-icons';
import { useStoreState } from '@/state/hooks';
import useStatus from '@/plugins/useStatus';
import { updateModule } from '@/api/routes/admin/auth/module';

export default () => {
    const { status, setStatus } = useStatus();
    const { clearFlashes, clearAndAddHttpError } = useFlash();
    const settings = useStoreState(state => state.everest.data!.auth.registration);

    const update = async (key: string, value: any) => {
        clearFlashes();
        setStatus('loading');

        updateModule('registration', key, value)
            .then(() => {
                setStatus('success');
            })
            .catch(error => {
                setStatus('error');
                clearAndAddHttpError({ key: 'auth:registration', error });
            });
    };

    return (
        <AdminBox title={'Registration Module'} icon={faUserPlus} byKey={'auth:registration'} status={status}>
            <div>
                <Label>Allow Email Registration</Label>
                <Select
                    id={'enabled'}
                    name={'enabled'}
                    onChange={e => update('enabled', e.target.value)}
                    autoComplete={'off'}
                >
                    <option value={1} selected={settings.enabled}>
                        Enabled
                    </option>
                    <option value={0} selected={!settings.enabled}>
                        Disabled
                    </option>
                </Select>
                <p className={'mt-1 text-xs text-gray-400'}>
                    Toggle whether users can register using the built-in email/password pages.
                </p>
            </div>
        </AdminBox>
    );
};

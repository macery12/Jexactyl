import AdminBox from '@/elements/AdminBox';
import { faDoorOpen } from '@fortawesome/free-solid-svg-icons';
import { Alert } from '@/elements/alert';

/**
 * Placeholder component shown when jGuard is enabled on the main Auth modules page.
 * Full jGuard configuration is available under Auth → jGuard Settings.
 */
export default () => {
    return (
        <AdminBox title={'jGuard'} icon={faDoorOpen}>
            <Alert type={'info'}>
                <span className={'text-xs'}>
                    jGuard is enabled. Configure it and manage pending accounts under the{' '}
                    <a href={'/admin/auth/jguard'} className={'underline underline-offset-2 hover:text-white'}>
                        jGuard Settings
                    </a>{' '}
                    tab.
                </span>
            </Alert>
        </AdminBox>
    );
};

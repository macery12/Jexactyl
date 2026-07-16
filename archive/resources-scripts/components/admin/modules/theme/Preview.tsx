import AdminBox from '@/elements/AdminBox';
import { useStoreState } from '@/state/hooks';
import { faDesktop } from '@fortawesome/free-solid-svg-icons';

export default ({ reload }: { reload: boolean }) => {
    const { primary } = useStoreState(s => s.theme.data!.colors);

    return (
        <AdminBox title={'Preview'} icon={faDesktop} className={'lg:col-span-2'}>
            <iframe
                src={reload ? '/null' : '/'}
                style={{ borderColor: primary }}
                className={'h-[60vh] w-full rounded-lg border-2 transition duration-500'}
            />
        </AdminBox>
    );
};

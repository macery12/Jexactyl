import tw from 'twin.macro';
import ReinstallServerBox from '@admin/management/servers/manage/ReinstallServerBox';
import FlashMessageRender from '@/elements/FlashMessageRender';
import { useEffect } from 'react';
import useFlash from '@/plugins/useFlash';
import ToggleInstallStatusBox from '@admin/management/servers/manage/ToggleInstallStatusBox';
import { useServerFromRoute } from '@/api/routes/admin/server';
import SuspendServerBox from './manage/SuspendServerBox';
import UnsuspendServerBox from './manage/UnsuspendServerBox';
import TransferServerBox from './manage/TransferServerBox';
import ServerDeleteButton from './ServerDeleteButton';

export default () => {
    const { data: server } = useServerFromRoute();
    const { clearFlashes } = useFlash();

    if (!server) return null;

    useEffect(() => {
        clearFlashes('server:manage');
    }, []);

    return (
        <>
            <FlashMessageRender byKey={'server:manage'} className={'mb-4'} />

            <div css={tw`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-4 gap-y-4 mb-8`}>
                <ReinstallServerBox />
                <ToggleInstallStatusBox />
                {server.status === 'suspended' ? <UnsuspendServerBox /> : <SuspendServerBox />}
                <TransferServerBox />
            </div>

            {/* Delete Server Section */}
            <div css={tw`mt-8 rounded-lg border-2 border-red-600 bg-red-600 bg-opacity-10 p-6`}>
                <h3 css={tw`text-lg font-medium text-red-300 mb-2`}>Delete Server</h3>
                <p css={tw`text-sm text-red-200 mb-4`}>
                    Permanently delete this server and all of its data. This action cannot be undone.
                </p>
                <ServerDeleteButton />
            </div>
        </>
    );
};

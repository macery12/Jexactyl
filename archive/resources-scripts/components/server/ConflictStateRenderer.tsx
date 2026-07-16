import ServerInstallSvg from '@/assets/images/server_installing.svg';
import ServerErrorSvg from '@/assets/images/server_error.svg';
import ServerRestoreSvg from '@/assets/images/server_restore.svg';
import ScreenBlock from '@/elements/ScreenBlock';
import { ServerContext } from '@/state/server';
import { useStoreState } from '@/state/hooks';
import AdminBypassButton from '@/elements/AdminBypassButton';

export default () => {
    const status = ServerContext.useStoreState(state => state.server.data?.status || null);
    const isTransferring = ServerContext.useStoreState(state => state.server.data?.isTransferring || false);
    const isNodeUnderMaintenance = ServerContext.useStoreState(
        state => state.server.data?.isNodeUnderMaintenance || false,
    );
    const serverUuid = ServerContext.useStoreState(state => state.server.data?.uuid);
    const rootAdmin = useStoreState(state => state.user.data!.rootAdmin);

    const renderAdminBypassButton = () => {
        if (!rootAdmin || !serverUuid) return null;

        return (
            <AdminBypassButton
                serverUuid={serverUuid}
                bypassType="conflict"
                serverStatus={status}
                position="absolute"
            />
        );
    };

    return status === 'installing' || status === 'install_failed' || status === 'reinstall_failed' ? (
        <ScreenBlock
            title={'Running Installer'}
            image={ServerInstallSvg}
            message={'Your server should be ready soon, please try again in a few minutes.'}
        >
            {renderAdminBypassButton()}
        </ScreenBlock>
    ) : status === 'suspended' ? (
        <ScreenBlock
            title={'Server Suspended'}
            image={ServerErrorSvg}
            message={'This server is suspended and cannot be accessed.'}
        >
            {renderAdminBypassButton()}
        </ScreenBlock>
    ) : isNodeUnderMaintenance ? (
        <ScreenBlock
            title={'Node under Maintenance'}
            image={ServerErrorSvg}
            message={'The node of this server is currently under maintenance.'}
        >
            {renderAdminBypassButton()}
        </ScreenBlock>
    ) : (
        <ScreenBlock
            title={isTransferring ? 'Transferring' : 'Restoring from Backup'}
            image={ServerRestoreSvg}
            message={
                isTransferring
                    ? 'Your server is being transferred to a new node, please check back later.'
                    : 'Your server is currently being restored from a backup, please check back in a few minutes.'
            }
        >
            {renderAdminBypassButton()}
        </ScreenBlock>
    );
};

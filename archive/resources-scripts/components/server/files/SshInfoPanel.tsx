import { useEffect, useState } from 'react';
import { ServerContext } from '@/state/server';
import { getSshInfo, SshInfo } from '@/api/routes/server/wingsRs';
import useFlash from '@/plugins/useFlash';
import CopyOnClick from '@/elements/CopyOnClick';
import Input from '@/elements/Input';
import Label from '@/elements/Label';
import tw from 'twin.macro';
import SpinnerOverlay from '@/elements/SpinnerOverlay';

export default () => {
    const [loading, setLoading] = useState(true);
    const [sshInfo, setSshInfo] = useState<SshInfo | null>(null);
    const { addError } = useFlash();

    const uuid = ServerContext.useStoreState(state => state.server.data!.uuid);
    const isSupercharged = ServerContext.useStoreState(state => state.server.data!.isNodeSupercharged);

    useEffect(() => {
        if (!isSupercharged) {
            setLoading(false);
            return;
        }

        getSshInfo(uuid)
            .then(data => {
                setSshInfo(data);
                setLoading(false);
            })
            .catch(error => {
                console.error(error);
                addError({ key: 'files', message: 'Failed to load SSH details.' });
                setLoading(false);
            });
    }, [uuid, isSupercharged]);

    // Don't render at all if not supercharged, or done loading with no data
    if (!isSupercharged || (!loading && !sshInfo)) return null;

    const sshCommand = sshInfo ? sshInfo.command || `ssh ${sshInfo.username}@${sshInfo.host} -p ${sshInfo.port}` : '';

    return (
        <div css={tw`relative mt-6 border-t border-black/30 pt-6`}>
            <SpinnerOverlay visible={loading} />
            <p css={tw`mb-4 text-sm font-semibold`}>SSH Access</p>

            {sshInfo && (
                <>
                    <div>
                        <Label>SSH Command</Label>
                        <CopyOnClick text={sshCommand}>
                            <Input type={'text'} value={sshCommand} readOnly />
                        </CopyOnClick>
                    </div>
                    <div css={tw`mt-4`}>
                        <Label>Host</Label>
                        <CopyOnClick text={sshInfo.host}>
                            <Input type={'text'} value={`${sshInfo.host}:${sshInfo.port}`} readOnly />
                        </CopyOnClick>
                    </div>
                    <div css={tw`mt-4`}>
                        <Label>Username</Label>
                        <CopyOnClick text={sshInfo.username}>
                            <Input type={'text'} value={sshInfo.username} readOnly />
                        </CopyOnClick>
                    </div>

                    <div
                        css={tw`mt-4 border-l-4 p-3`}
                        style={{ borderColor: sshInfo.container_supported ? '#22c55e' : '#06b6d4' }}
                    >
                        <p css={tw`text-xs text-neutral-200`}>
                            {sshInfo.container_supported ? 'Direct container SSH is supported on this node. ' : ''}
                            Use your panel password to authenticate.
                        </p>
                    </div>
                </>
            )}
        </div>
    );
};

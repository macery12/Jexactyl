import { useState } from 'react';
import tw from 'twin.macro';
import { ServerContext } from '@/state/server';
import { Button } from '@/elements/button';
import { downloadMod } from '@/api/routes/server/mods';
import useFlash from '@/plugins/useFlash';
import { httpErrorToHuman } from '@/api/http';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faDownload, faCheck, faClock, faBan } from '@fortawesome/free-solid-svg-icons';
import Can from '@/elements/Can';
import { useModCooldown } from './useModCooldown';

interface Props {
    modId: number | string;
    fileId: number | string;
    fileName?: string;
    source: string;
    contentType?: 'mods' | 'plugins';
    disabledReason?: string | null;
}

export default ({ modId, fileId, source, contentType = 'mods', disabledReason }: Props) => {
    const uuid = ServerContext.useStoreState(state => state.server.data!.uuid);
    const { addError } = useFlash();
    const [onCooldown, startCooldown] = useModCooldown(modId);

    const [queuing, setQueuing] = useState(false);
    const [queued, setQueued] = useState(false);

    const handleDownload = () => {
        if (queuing || onCooldown) return;

        setQueuing(true);
        setQueued(false);

        downloadMod(uuid, modId, fileId, source, contentType)
            .then(() => {
                setQueued(true);
                startCooldown();
                setTimeout(() => setQueued(false), 2500);
            })
            .catch(error => {
                console.error(error);
                addError({ key: 'mods', message: httpErrorToHuman(error) });
            })
            .finally(() => setQueuing(false));
    };

    const isDisabled = queuing || queued || onCooldown || Boolean(disabledReason);

    return (
        <Can action={'file.create'}>
            <Button
                size={Button.Sizes.Small}
                onClick={handleDownload}
                disabled={isDisabled}
                css={[queued && tw`bg-green-600 hover:bg-green-700`, tw`min-w-[100px]`]}
            >
                {queuing ? (
                    <>
                        <FontAwesomeIcon icon={faClock} css={tw`mr-2 animate-pulse`} />
                        Queuing...
                    </>
                ) : queued ? (
                    <>
                        <FontAwesomeIcon icon={faCheck} css={tw`mr-2`} />
                        Queued
                    </>
                ) : onCooldown ? (
                    <>
                        <FontAwesomeIcon icon={faBan} css={tw`mr-2 text-neutral-500`} />
                        Wait...
                    </>
                ) : disabledReason ? (
                    disabledReason
                ) : (
                    <>
                        <FontAwesomeIcon icon={faDownload} css={tw`mr-2`} />
                        Download
                    </>
                )}
            </Button>
        </Can>
    );
};

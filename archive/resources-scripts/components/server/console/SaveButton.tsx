import stripAnsi from 'strip-ansi';
import useFlash from '@/plugins/useFlash';
import { useEffect, useState } from 'react';
import { ServerContext } from '@/state/server';
import { SocketEvent } from '@server/events';
import { saveFileContents } from '@/api/routes/server/files';
import classNames from 'classnames';
import { DownloadIcon } from '@heroicons/react/outline';

export default () => {
    const [log, setLog] = useState<string[]>([]);

    const { addFlash, clearFlashes, clearAndAddHttpError } = useFlash();
    const uuid = ServerContext.useStoreState(state => state.server.data!.uuid);
    const { connected, instance } = ServerContext.useStoreState(state => state.socket);

    const addLog = (data: string) => {
        setLog(prevLog => [...prevLog, data.startsWith('>') ? data.substring(1) : data]);
    };

    const submit = () => {
        clearFlashes('console:share');

        const data = stripAnsi(log.map(it => it.replace('\r', '')).join('\n')) || '';

        saveFileContents(uuid, '/.console-logs/' + new Date().toLocaleTimeString() + '.log', data)
            .then(() => {
                addFlash({
                    key: 'console:share',
                    type: 'success',
                    message: 'Your server logs have been saved to the .console-logs folder.',
                });
            })
            .catch(error => {
                clearAndAddHttpError({ key: 'console:share', error });
            });
    };

    useEffect(() => {
        if (!connected || !instance) return;

        instance.addListener(SocketEvent.CONSOLE_OUTPUT, addLog);

        return () => {
            instance.removeListener(SocketEvent.CONSOLE_OUTPUT, addLog);
        };
    }, [connected, instance]);

    return (
        <div
            className={classNames(
                'inline-flex hidden items-center justify-center px-4 py-2 md:flex',
                'cursor-pointer rounded font-semibold duration-300 hover:bg-slate-700',
            )}
            onClick={submit}
        >
            <DownloadIcon className={'mr-1 w-5'} /> Save
        </div>
    );
};

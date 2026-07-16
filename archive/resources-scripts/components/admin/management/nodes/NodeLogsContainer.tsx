import { useEffect, useState } from 'react';
import tw from 'twin.macro';
import AdminBox from '@/elements/AdminBox';
import SpinnerOverlay from '@/elements/SpinnerOverlay';
import { Context } from '@admin/management/nodes/NodeRouter';
import { getSystemLogs, getSystemLogContents, LogFile } from '@/api/routes/admin/nodes/wingsRs';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileAlt, faArrowLeft, faSync } from '@fortawesome/free-solid-svg-icons';
import useFlash from '@/plugins/useFlash';
import { Button } from '@/elements/button';

const stripAnsi = (input: string): string => {
    return input.replace(/\u001B\[[0-9;?]*[ -/]*[@-~]/g, '');
};

export default () => {
    const { clearFlashes, addError } = useFlash();
    const [loading, setLoading] = useState(true);
    const [logFiles, setLogFiles] = useState<LogFile[]>([]);
    const [selectedLog, setSelectedLog] = useState<string | null>(null);
    const [logContents, setLogContents] = useState<string[]>([]);
    const [logLoading, setLogLoading] = useState(false);

    const node = Context.useStoreState(state => state.node);

    if (!node) return null;

    useEffect(() => {
        clearFlashes('node:logs');
        getSystemLogs(node.id)
            .then(data => {
                setLogFiles(data);
                setLoading(false);
            })
            .catch(error => {
                console.error(error);
                addError({ key: 'node:logs', message: 'Failed to load log files.' });
                setLoading(false);
            });
    }, []);

    const openLog = (file: string) => {
        setSelectedLog(file);
        setLogLoading(true);
        getSystemLogContents(node.id, file, 200)
            .then(lines => {
                setLogContents(lines);
                setLogLoading(false);
            })
            .catch(error => {
                console.error(error);
                addError({ key: 'node:logs', message: `Failed to load log: ${file}` });
                setLogLoading(false);
            });
    };

    const refreshLog = () => {
        if (selectedLog) openLog(selectedLog);
    };

    const formatSize = (bytes: number): string => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    if (selectedLog) {
        return (
            <AdminBox
                icon={faFileAlt}
                title={selectedLog}
                button={
                    <div css={tw`ml-auto flex gap-2`}>
                        <button onClick={refreshLog} css={tw`text-sm text-neutral-300 hover:text-neutral-100`}>
                            <FontAwesomeIcon icon={faSync} css={tw`mr-1`} />
                            Refresh
                        </button>
                        <button
                            onClick={() => {
                                setSelectedLog(null);
                                setLogContents([]);
                            }}
                            css={tw`text-sm text-neutral-300 hover:text-neutral-100`}
                        >
                            <FontAwesomeIcon icon={faArrowLeft} css={tw`mr-1`} />
                            Back
                        </button>
                    </div>
                }
                css={tw`relative`}
            >
                <SpinnerOverlay visible={logLoading} />
                <div className={'max-h-[600px] overflow-y-auto rounded bg-black/50 p-4 font-mono text-sm'}>
                    {logContents.length === 0 ? (
                        <p className={'text-gray-500'}>No log entries found.</p>
                    ) : (
                        logContents.map((line, i) => (
                            <div
                                key={i}
                                className={'border-b border-gray-800/50 py-0.5 text-gray-300 hover:bg-white/5'}
                            >
                                <span className={'mr-3 select-none text-gray-600'}>{i + 1}</span>
                                {stripAnsi(line)}
                            </div>
                        ))
                    )}
                </div>
            </AdminBox>
        );
    }

    return (
        <AdminBox icon={faFileAlt} title={'System Logs'} css={tw`relative`}>
            <SpinnerOverlay visible={loading} />
            {logFiles.length === 0 ? (
                <p className={'text-center text-gray-400'}>No log files available.</p>
            ) : (
                <div className={'space-y-2'}>
                    {logFiles.map(file => (
                        <div
                            key={file.name}
                            onClick={() => openLog(file.name)}
                            className={
                                'flex cursor-pointer items-center justify-between rounded bg-black/30 p-3 transition hover:bg-black/50'
                            }
                        >
                            <div className={'flex items-center gap-3'}>
                                <FontAwesomeIcon icon={faFileAlt} className={'text-gray-400'} />
                                <div>
                                    <p className={'font-medium text-gray-200'}>{file.name}</p>
                                    <p className={'text-xs text-gray-500'}>
                                        {formatSize(file.size)}
                                        {file.modified && ` · Modified ${new Date(file.modified).toLocaleString()}`}
                                    </p>
                                </div>
                            </div>
                            <Button size={Button.Sizes.Small} css={tw`ml-2`}>
                                View
                            </Button>
                        </div>
                    ))}
                </div>
            )}
        </AdminBox>
    );
};

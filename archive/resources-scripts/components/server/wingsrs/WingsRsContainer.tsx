import { useEffect, useState } from 'react';
import tw from 'twin.macro';
import { ServerContext } from '@/state/server';
import { getWingsRsStatus, getInstallLogs, abortInstall, runScript, WingsRsStatus } from '@/api/routes/server/wingsRs';
import useFlash from '@/plugins/useFlash';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBoltLightning, faCheck, faCode, faFileAlt, faSync, faStopCircle } from '@fortawesome/free-solid-svg-icons';
import { Button } from '@/elements/button';
import { Dialog } from '@/elements/dialog';
import SpinnerOverlay from '@/elements/SpinnerOverlay';
import Can from '@/elements/Can';
import PageContentBlock from '@/elements/PageContentBlock';
import TitledGreyBox from '@/elements/TitledGreyBox';

export default () => {
    const uuid = ServerContext.useStoreState(state => state.server.data!.uuid);
    const isSupercharged = ServerContext.useStoreState(state => state.server.data!.isNodeSupercharged);
    const status = ServerContext.useStoreState(state => state.server.data!.status);
    const { clearFlashes, addError, addFlash } = useFlash();

    const [wingsStatus, setWingsStatus] = useState<WingsRsStatus | null>(null);
    const [loading, setLoading] = useState(true);
    const [installLogs, setInstallLogs] = useState<string[]>([]);
    const [logsLoading, setLogsLoading] = useState(false);
    const [showScript, setShowScript] = useState(false);
    const [script, setScript] = useState('');
    const [scriptRunning, setScriptRunning] = useState(false);
    const [showAbortConfirm, setShowAbortConfirm] = useState(false);

    useEffect(() => {
        if (!isSupercharged) {
            setLoading(false);
            return;
        }

        clearFlashes('server:wingsrs');
        getWingsRsStatus(uuid)
            .then(data => {
                setWingsStatus(data);
                setLoading(false);
            })
            .catch(error => {
                console.error(error);
                setLoading(false);
            });
    }, [uuid, isSupercharged]);

    const fetchInstallLogs = () => {
        setLogsLoading(true);
        getInstallLogs(uuid, 100)
            .then(lines => {
                setInstallLogs(lines);
                setLogsLoading(false);
            })
            .catch(_error => {
                addError({ key: 'server:wingsrs', message: 'Failed to load install logs.' });
                setLogsLoading(false);
            });
    };

    const handleAbortInstall = () => {
        abortInstall(uuid)
            .then(() => {
                addFlash({
                    key: 'server:wingsrs',
                    type: 'success',
                    message: 'Installation abort signal sent.',
                });
                setShowAbortConfirm(false);
            })
            .catch(_error => {
                addError({ key: 'server:wingsrs', message: 'Failed to abort installation.' });
                setShowAbortConfirm(false);
            });
    };

    const handleRunScript = () => {
        if (!script.trim()) return;
        setScriptRunning(true);
        clearFlashes('server:wingsrs');
        runScript(uuid, { script })
            .then(() => {
                addFlash({
                    key: 'server:wingsrs',
                    type: 'success',
                    message: 'Script execution started successfully.',
                });
                setShowScript(false);
                setScript('');
                setScriptRunning(false);
            })
            .catch(_error => {
                addError({ key: 'server:wingsrs', message: 'Failed to execute script.' });
                setScriptRunning(false);
            });
    };

    if (!isSupercharged) {
        return (
            <PageContentBlock title={'Wings-RS'} showFlashKey={'server:wingsrs'}>
                <div className={'rounded-lg bg-black/20 p-8 text-center'}>
                    <FontAwesomeIcon icon={faBoltLightning} className={'mb-4 text-4xl text-gray-600'} />
                    <p className={'text-gray-400'}>
                        This server&apos;s node is not running Wings-RS. Supercharged features are not available.
                    </p>
                </div>
            </PageContentBlock>
        );
    }

    return (
        <PageContentBlock title={'Wings-RS'} showFlashKey={'server:wingsrs'}>
            <SpinnerOverlay visible={loading} />

            <div className={'grid gap-4 lg:grid-cols-2'}>
                {/* Status */}
                <TitledGreyBox title={'Supercharged Status'} icon={faBoltLightning}>
                    {wingsStatus && (
                        <div className={'space-y-3'}>
                            <div className={'flex items-center gap-2'}>
                                <FontAwesomeIcon icon={faCheck} className={'text-green-400'} />
                                <span className={'text-gray-200'}>Wings-RS Active</span>
                            </div>
                            <div className={'text-sm text-gray-400'}>
                                <p>
                                    Version:{' '}
                                    <code className={'rounded bg-black/50 px-1'}>{wingsStatus.wings_version}</code>
                                </p>
                            </div>
                            {Array.isArray(wingsStatus.features) && wingsStatus.features.length > 0 && (
                                <div className={'flex flex-wrap gap-1'}>
                                    {wingsStatus.features.map(feature => (
                                        <span
                                            key={feature}
                                            className={'rounded bg-green-600/20 px-2 py-0.5 text-xs text-green-300'}
                                        >
                                            {feature}
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </TitledGreyBox>

                {/* Quick Actions */}
                <TitledGreyBox title={'Quick Actions'} icon={faCode}>
                    <div className={'space-y-3'}>
                        <Can action={'control.console'}>
                            <Button onClick={fetchInstallLogs} css={tw`w-full`}>
                                <FontAwesomeIcon icon={faFileAlt} css={tw`mr-2`} />
                                View Install Logs
                            </Button>
                        </Can>
                        <Can action={'startup.update'}>
                            <Button onClick={() => setShowScript(true)} css={tw`w-full`}>
                                <FontAwesomeIcon icon={faCode} css={tw`mr-2`} />
                                Run Script
                            </Button>
                        </Can>
                        {status === 'installing' && (
                            <Can action={'settings.reinstall'}>
                                <Button.Danger onClick={() => setShowAbortConfirm(true)} css={tw`w-full`}>
                                    <FontAwesomeIcon icon={faStopCircle} css={tw`mr-2`} />
                                    Abort Installation
                                </Button.Danger>
                            </Can>
                        )}
                    </div>
                </TitledGreyBox>
            </div>

            {/* Install Logs */}
            {Array.isArray(installLogs) && installLogs.length > 0 && (
                <div className={'mt-4'}>
                    <TitledGreyBox title={'Install Logs'} icon={faFileAlt}>
                        <div className={'flex justify-end mb-2'}>
                            <button onClick={fetchInstallLogs} className={'text-sm text-gray-400 hover:text-gray-200'}>
                                <FontAwesomeIcon icon={faSync} css={tw`mr-1`} />
                                Refresh
                            </button>
                        </div>
                        <SpinnerOverlay visible={logsLoading} />
                        <div className={'max-h-[400px] overflow-y-auto rounded bg-black/50 p-4 font-mono text-sm'}>
                            {installLogs.map((line, i) => (
                                <div key={i} className={'py-0.5 text-gray-300'}>
                                    <span className={'mr-3 select-none text-gray-600'}>{i + 1}</span>
                                    {line}
                                </div>
                            ))}
                        </div>
                    </TitledGreyBox>
                </div>
            )}

            {/* Script Execution Dialog */}
            <Dialog
                open={showScript}
                onClose={() => setShowScript(false)}
                title={'Run Script'}
                description={'Execute a shell script on this server via Wings-RS.'}
            >
                <div className={'mt-4 space-y-4'}>
                    <textarea
                        value={script}
                        onChange={e => setScript(e.target.value)}
                        placeholder={'#!/bin/bash\necho "Hello, World!"'}
                        className={
                            'h-48 w-full rounded border border-gray-700 bg-black/50 p-3 font-mono text-sm text-gray-200 placeholder-gray-600 focus:border-blue-500 focus:outline-none'
                        }
                    />
                    <p className={'text-xs text-gray-500'}>
                        The script will be executed inside the server&apos;s container. Use with caution.
                    </p>
                </div>
                <Dialog.Footer>
                    <Button onClick={() => setShowScript(false)} className={'mr-2'}>
                        Cancel
                    </Button>
                    <Button onClick={handleRunScript} disabled={scriptRunning || !script.trim()}>
                        {scriptRunning ? 'Executing...' : 'Execute Script'}
                    </Button>
                </Dialog.Footer>
            </Dialog>

            {/* Abort Install Confirmation */}
            <Dialog.Confirm
                open={showAbortConfirm}
                onClose={() => setShowAbortConfirm(false)}
                title={'Abort Installation'}
                confirm={'Abort'}
                onConfirmed={handleAbortInstall}
            >
                Are you sure you want to abort the current installation? This will stop the installation process and may
                leave the server in an incomplete state.
            </Dialog.Confirm>
        </PageContentBlock>
    );
};

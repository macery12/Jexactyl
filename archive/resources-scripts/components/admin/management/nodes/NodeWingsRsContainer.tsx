import { useEffect, useState } from 'react';
import tw from 'twin.macro';
import AdminBox from '@/elements/AdminBox';
import SpinnerOverlay from '@/elements/SpinnerOverlay';
import { Context } from '@admin/management/nodes/NodeRouter';
import {
    detectWingsRs,
    getSystemOverview,
    SystemOverview,
    WingsRsDetectionResult,
} from '@/api/routes/admin/nodes/wingsRs';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBoltLightning, faRocket, faCheck, faTimes } from '@fortawesome/free-solid-svg-icons';
import useFlash from '@/plugins/useFlash';
import { Button } from '@/elements/button';
import NodeStatsContainer from '@admin/management/nodes/NodeStatsContainer';
import NodeLogsContainer from '@admin/management/nodes/NodeLogsContainer';

const Code = ({ children }: { children: React.ReactNode }) => (
    <code css={tw`text-sm font-mono bg-neutral-900 rounded`} style={{ padding: '2px 6px' }}>
        {children}
    </code>
);

export default () => {
    const { clearFlashes, addError, addFlash } = useFlash();
    const [detecting, setDetecting] = useState(false);
    const [overview, setOverview] = useState<SystemOverview | null>(null);
    const [_overviewLoading, setOverviewLoading] = useState(true);

    const node = Context.useStoreState(state => state.node);
    const setNode = Context.useStoreActions(actions => actions.setNode);

    if (!node) return null;

    const isSupercharged = node.wingsType === 'wings-rs';

    useEffect(() => {
        if (isSupercharged) {
            clearFlashes('node:wingsrs');
            getSystemOverview(node.id)
                .then(data => {
                    setOverview(data);
                    setOverviewLoading(false);
                })
                .catch(() => {
                    setOverviewLoading(false);
                });
        } else {
            setOverviewLoading(false);
        }
    }, [isSupercharged]);

    const handleDetect = () => {
        setDetecting(true);
        clearFlashes('node:wingsrs');
        detectWingsRs(node.id)
            .then((result: WingsRsDetectionResult) => {
                if (result.detected) {
                    addFlash({
                        key: 'node:wingsrs',
                        type: 'success',
                        message: `Wings-RS detected! Version: ${result.wings_version}`,
                    });
                    // Update node in context
                    setNode({
                        ...node,
                        wingsType: result.wings_type,
                        wingsVersion: result.wings_version,
                        wingsDetectedAt: new Date(),
                    });
                } else {
                    addFlash({
                        key: 'node:wingsrs',
                        type: 'info',
                        message: 'This node is running standard Wings. Wings-RS features are not available.',
                    });
                }
                setDetecting(false);
            })
            .catch(error => {
                console.error(error);
                addError({ key: 'node:wingsrs', message: 'Failed to detect Wings type.' });
                setDetecting(false);
            });
    };

    return (
        <div className={'grid gap-4'}>
            <AdminBox
                icon={faBoltLightning}
                title={'Wings-RS Integration'}
                button={
                    <Button size={Button.Sizes.Small} css={tw`ml-auto`} onClick={handleDetect} disabled={detecting}>
                        <FontAwesomeIcon icon={faRocket} css={tw`mr-1`} />
                        {detecting ? 'Detecting...' : 'Re-detect'}
                    </Button>
                }
                css={tw`relative`}
            >
                <SpinnerOverlay visible={detecting} />
                <div className={'space-y-4'}>
                    <div className={'flex items-center gap-3'}>
                        <FontAwesomeIcon
                            icon={isSupercharged ? faCheck : faTimes}
                            className={isSupercharged ? 'text-green-400' : 'text-gray-500'}
                        />
                        <span className={'text-gray-200'}>
                            {isSupercharged
                                ? 'This node is running Wings-RS (Supercharged)'
                                : 'This node is running standard Wings'}
                        </span>
                    </div>

                    {isSupercharged && (
                        <table>
                            <tbody>
                                <tr>
                                    <td css={tw`py-1 pr-6 text-gray-400`}>Wings Type</td>
                                    <td css={tw`py-1`}>
                                        <Code>{node.wingsType}</Code>
                                    </td>
                                </tr>
                                <tr>
                                    <td css={tw`py-1 pr-6 text-gray-400`}>Version</td>
                                    <td css={tw`py-1`}>
                                        <Code>{node.wingsVersion || 'Unknown'}</Code>
                                    </td>
                                </tr>
                                {node.wingsDetectedAt && (
                                    <tr>
                                        <td css={tw`py-1 pr-6 text-gray-400`}>Detected At</td>
                                        <td css={tw`py-1`}>
                                            <Code>{new Date(node.wingsDetectedAt).toLocaleString()}</Code>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    )}

                    {isSupercharged && overview && (
                        <>
                            <hr className={'border-gray-700'} />
                            <table>
                                <tbody>
                                    <tr>
                                        <td css={tw`py-1 pr-6 text-gray-400`}>Rust Version</td>
                                        <td css={tw`py-1`}>
                                            <Code>{overview.rust_version || 'N/A'}</Code>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td css={tw`py-1 pr-6 text-gray-400`}>Build Date</td>
                                        <td css={tw`py-1`}>
                                            <Code>{overview.build_date || 'N/A'}</Code>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td css={tw`py-1 pr-6 text-gray-400`}>Kernel</td>
                                        <td css={tw`py-1`}>
                                            <Code>{overview.kernel}</Code>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td css={tw`py-1 pr-6 text-gray-400`}>Uptime</td>
                                        <td css={tw`py-1`}>
                                            <Code>
                                                {typeof overview.uptime === 'number'
                                                    ? `${Math.floor(overview.uptime / 3600)}h ${Math.floor(
                                                          (overview.uptime % 3600) / 60,
                                                      )}m`
                                                    : 'N/A'}
                                            </Code>
                                        </td>
                                    </tr>
                                    {overview.features.length > 0 && (
                                        <tr>
                                            <td css={tw`py-1 pr-6 text-gray-400`}>Features</td>
                                            <td css={tw`py-1`}>
                                                <div className={'flex flex-wrap gap-1'}>
                                                    {overview.features.map(feature => (
                                                        <span
                                                            key={feature}
                                                            className={
                                                                'rounded bg-green-600/20 px-2 py-0.5 text-xs text-green-300'
                                                            }
                                                        >
                                                            {feature}
                                                        </span>
                                                    ))}
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </>
                    )}

                    {!isSupercharged && (
                        <p className={'text-sm text-gray-500'}>
                            Click &quot;Re-detect&quot; to check if this node has been upgraded to Wings-RS. Wings-RS
                            enables supercharged features like real-time stats, log viewing, advanced file operations,
                            and more.
                        </p>
                    )}
                </div>
            </AdminBox>

            {isSupercharged && <NodeStatsContainer />}
            {isSupercharged && <NodeLogsContainer />}
        </div>
    );
};

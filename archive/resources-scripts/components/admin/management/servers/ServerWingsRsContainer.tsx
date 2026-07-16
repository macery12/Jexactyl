import { useEffect, useState } from 'react';
import tw from 'twin.macro';
import { useServerFromRoute } from '@/api/routes/admin/server';
import AdminBox from '@/elements/AdminBox';
import SpinnerOverlay from '@/elements/SpinnerOverlay';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBoltLightning, faFileAlt, faSync } from '@fortawesome/free-solid-svg-icons';
import { getAdminServerWingsStatus, getAdminServerInstallLogs } from '@/api/routes/admin/servers/wingsRs';
import useFlash from '@/plugins/useFlash';

export default () => {
    const { data: server } = useServerFromRoute();
    const { addError } = useFlash();

    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState<{
        supercharged: boolean;
        wings_type: string;
        wings_version: string | null;
    } | null>(null);
    const [logs, setLogs] = useState<string[]>([]);
    const [logsMissing, setLogsMissing] = useState(false);
    const [logsLoading, setLogsLoading] = useState(false);

    const load = async () => {
        if (!server) return;

        try {
            setLoading(true);
            const statusData = await getAdminServerWingsStatus(server.id);

            setStatus(statusData);
        } catch (error) {
            console.error(error);
            addError({ key: 'server', message: 'Failed to load Wings-RS server details.' });
        } finally {
            setLoading(false);
        }
    };

    const loadLogs = async () => {
        if (!server) return;

        try {
            setLogsLoading(true);
            const response = await getAdminServerInstallLogs(server.id, 100);
            setLogs(response.content);
            setLogsMissing(response.missing);
        } catch (error) {
            console.error(error);
            addError({ key: 'server', message: 'Failed to load install logs.' });
        } finally {
            setLogsLoading(false);
        }
    };

    useEffect(() => {
        load();
    }, [server?.id]);

    if (!server) return null;

    if (status && !status.supercharged) {
        return (
            <AdminBox title={'Wings-RS'} icon={faBoltLightning}>
                <p css={tw`text-gray-400`}>This server&apos;s node is not running Wings-RS.</p>
            </AdminBox>
        );
    }

    return (
        <div className={'space-y-4'}>
            <AdminBox title={'Wings-RS Status'} icon={faBoltLightning} css={tw`relative`}>
                <SpinnerOverlay visible={loading} />
                <div className={'grid gap-2 text-sm text-gray-300'}>
                    <div>
                        Type: <span className={'font-mono'}>{status?.wings_type ?? 'unknown'}</span>
                    </div>
                    <div>
                        Version: <span className={'font-mono'}>{status?.wings_version ?? 'unknown'}</span>
                    </div>
                </div>
            </AdminBox>

            <AdminBox
                title={'Install Logs'}
                icon={faFileAlt}
                button={
                    <button onClick={loadLogs} css={tw`ml-auto text-sm text-neutral-300 hover:text-neutral-100`}>
                        <FontAwesomeIcon icon={faSync} css={tw`mr-1`} />
                        Refresh
                    </button>
                }
                css={tw`relative`}
            >
                <SpinnerOverlay visible={logsLoading} />
                {logsMissing ? (
                    <p css={tw`text-sm text-gray-500`}>No installation log file exists yet for this server.</p>
                ) : logs.length === 0 ? (
                    <p css={tw`text-sm text-gray-500`}>Click refresh to load installation logs.</p>
                ) : (
                    <div className={'max-h-[420px] overflow-y-auto rounded bg-black/40 p-4 font-mono text-xs'}>
                        {logs.map((line, index) => (
                            <div key={index} className={'py-0.5 text-gray-300'}>
                                {line}
                            </div>
                        ))}
                    </div>
                )}
            </AdminBox>
        </div>
    );
};

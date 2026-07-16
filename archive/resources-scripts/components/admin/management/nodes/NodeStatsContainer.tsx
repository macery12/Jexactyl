import { useEffect, useState, useRef } from 'react';
import tw from 'twin.macro';
import AdminBox from '@/elements/AdminBox';
import SpinnerOverlay from '@/elements/SpinnerOverlay';
import { Context } from '@admin/management/nodes/NodeRouter';
import { getSystemStats, SystemStats } from '@/api/routes/admin/nodes/wingsRs';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faMicrochip,
    faMemory,
    faHdd,
    faArrowUp,
    faArrowDown,
    faSync,
    faBoltLightning,
} from '@fortawesome/free-solid-svg-icons';
import type { IconDefinition } from '@fortawesome/free-solid-svg-icons';
import useFlash from '@/plugins/useFlash';

const toNumber = (value: unknown, fallback = 0): number => {
    const number = Number(value);

    return Number.isFinite(number) ? number : fallback;
};

const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const formatRate = (bytesPerSec: number): string => {
    return formatBytes(bytesPerSec) + '/s';
};

const StatCard = ({
    icon,
    title,
    value,
    subtitle,
    large,
}: {
    icon: IconDefinition;
    title: string;
    value: string;
    subtitle?: string;
    large?: boolean;
}) => (
    <div className={large ? 'col-span-2' : 'col-span-1'}>
        <div className={'rounded-lg bg-black/50 text-left shadow-xl'}>
            <div className={'grid w-full grid-cols-3 gap-4 p-4'}>
                <div className={'m-auto grid h-12 w-12 rounded-xl bg-black'}>
                    <div className={'m-auto'}>
                        <FontAwesomeIcon icon={icon} className={'text-xl'} />
                    </div>
                </div>
                <div className={'col-span-2 my-auto'}>
                    <p className={'text-xs font-bold uppercase text-gray-400'}>{title}</p>
                    <p className={'text-lg font-semibold text-gray-200'}>{value}</p>
                    {subtitle && <p className={'text-xs text-gray-500'}>{subtitle}</p>}
                </div>
            </div>
        </div>
    </div>
);

export default () => {
    const { clearFlashes, addError } = useFlash();
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<SystemStats | null>(null);
    const [autoRefresh, setAutoRefresh] = useState(true);
    const intervalRef = useRef<NodeJS.Timeout | null>(null);

    const node = Context.useStoreState(state => state.node);

    if (!node) return null;

    const fetchStats = () => {
        clearFlashes('node:stats');
        getSystemStats(node.id)
            .then(data => {
                setStats(data);
                setLoading(false);
            })
            .catch(error => {
                console.error(error);
                addError({ key: 'node:stats', message: 'Failed to load system stats.' });
                setLoading(false);
            });
    };

    useEffect(() => {
        fetchStats();
    }, []);

    useEffect(() => {
        if (autoRefresh) {
            intervalRef.current = setInterval(fetchStats, 5000);
        } else if (intervalRef.current) {
            clearInterval(intervalRef.current);
        }

        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [autoRefresh]);

    return (
        <AdminBox
            icon={faBoltLightning}
            title={'Real-Time System Stats'}
            button={
                <button
                    onClick={() => setAutoRefresh(!autoRefresh)}
                    css={tw`ml-auto text-sm text-neutral-300 hover:text-neutral-100`}
                >
                    <FontAwesomeIcon icon={faSync} className={autoRefresh ? 'animate-spin' : ''} css={tw`mr-1`} />
                    {autoRefresh ? 'Auto-refreshing' : 'Paused'}
                </button>
            }
            css={tw`relative`}
        >
            <SpinnerOverlay visible={loading} />
            {stats && (
                <div className={'grid gap-4 lg:grid-cols-3'}>
                    <StatCard
                        icon={faMicrochip}
                        title={'CPU Usage'}
                        value={`${toNumber(stats?.cpu?.used).toFixed(1)}%`}
                        subtitle={`${toNumber(stats?.cpu?.threads)} threads · ${stats?.cpu?.model ?? 'Unknown'}`}
                    />
                    <StatCard
                        large
                        icon={faMemory}
                        title={'Memory'}
                        value={`${formatBytes(toNumber(stats?.memory?.used))} / ${formatBytes(
                            toNumber(stats?.memory?.total),
                        )}`}
                        subtitle={`Process: ${formatBytes(toNumber(stats?.memory?.process))}`}
                    />
                    <StatCard
                        large
                        icon={faHdd}
                        title={'Disk'}
                        value={`${formatBytes(toNumber(stats?.disk?.used))} / ${formatBytes(
                            toNumber(stats?.disk?.total),
                        )}`}
                        subtitle={`Read: ${formatRate(toNumber(stats?.disk?.read_rate))} · Write: ${formatRate(
                            toNumber(stats?.disk?.write_rate),
                        )}`}
                    />
                    <StatCard
                        icon={faArrowDown}
                        title={'Network In'}
                        value={formatRate(toNumber(stats?.network?.received_rate))}
                    />
                    <StatCard
                        icon={faArrowUp}
                        title={'Network Out'}
                        value={formatRate(toNumber(stats?.network?.sent_rate))}
                    />
                </div>
            )}
        </AdminBox>
    );
};

import { useEffect, useRef, useState } from 'react';
import * as React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faFloppyDisk,
    faInfoCircle,
    faMemory,
    faMicrochip,
    faPlus,
    faPowerOff,
    faTrash,
    faXmarkCircle,
    IconDefinition,
} from '@fortawesome/free-solid-svg-icons';
import { Link } from 'react-router-dom';
import { ServerPowerState, ServerStats, type Server } from '@definitions/server';
import { getServerResourceUsage } from '@/api/routes/server';
import { useStoreState } from '@/state/hooks';
import classNames from 'classnames';
import { removeServerFromGroup } from '@/api/routes/server/groups';
import { type ServerGroup } from '@definitions/server';
import Pill from '@/elements/Pill';
import { VisibleDialog } from './groups/ServerGroupDialog';
import useFlash from '@/plugins/useFlash';

export function statusToColor(state?: ServerPowerState): string {
    switch (state) {
        case 'running':
            return 'text-green-500';
        case 'starting':
        case 'stopping':
            return 'text-yellow-500';
        default:
            return 'text-red-500';
    }
}

const UtilBox = ({
    utilised,
    icon,
    rounded,
    server,
}: {
    utilised: number;
    icon: IconDefinition;
    rounded?: string;
    server?: Server;
}) => {
    const stateLabel = server?.isTransferring
        ? 'Transferring'
        : server?.status === 'suspended'
          ? 'Suspended'
          : 'Offline';

    return (
        <div
            className={classNames(
                'col-span-2 m-auto h-full w-full min-w-0 bg-white/10 px-3 py-2 lg:col-span-1 lg:shadow-xl',
                rounded === 'left' && 'lg:rounded-l-lg',
                rounded === 'right' && 'lg:rounded-r-lg',
                rounded === 'full' && 'lg:col-span-3 lg:rounded-lg',
            )}
        >
            <div className={'flex items-center justify-center text-center font-bold text-gray-300'}>
                <span
                    className={
                        'inline-flex max-w-full flex-wrap items-center justify-center gap-x-1 text-xs sm:text-sm'
                    }
                >
                    <FontAwesomeIcon icon={icon} className={'mt-0.5 flex-shrink-0'} size={'xs'} />
                    <span className={'whitespace-normal break-words leading-tight'}>
                        {utilised > -1 ? `${utilised === Infinity ? 0 : utilised}%` : stateLabel}
                    </span>
                </span>
            </div>
        </div>
    );
};

type Timer = ReturnType<typeof setInterval>;

export default ({
    server,
    groups = [],
    setOpen,
}: {
    server: Server;
    groups?: ServerGroup[];
    setOpen: React.Dispatch<React.SetStateAction<VisibleDialog>>;
}) => {
    const { clearFlashes, addFlash, clearAndAddHttpError } = useFlash();
    const [stats, setStats] = useState<ServerStats>();
    const colors = useStoreState(state => state.theme.data!.colors);
    const interval = useRef<Timer>(null) as React.MutableRefObject<Timer>;
    const [isSuspended, setIsSuspended] = useState(server.status === 'suspended');
    const [removedGroupIds, setRemovedGroupIds] = useState<number[]>([]);

    const visibleGroups = groups.filter(g => !removedGroupIds.includes(g.id));

    const onDelete = (groupId: number) => {
        clearFlashes();

        removeServerFromGroup(groupId, server.uuid)
            .then(() => {
                addFlash({ type: 'success', key: 'dashboard:groups', message: 'Server group removed successfully.' });
                setRemovedGroupIds(prev => [...prev, groupId]);
            })
            .catch(error => clearAndAddHttpError({ key: 'dashboard:groups', error }));
    };

    const getStats = () =>
        getServerResourceUsage(server.uuid)
            .then(data => setStats(data))
            .catch(error => console.error(error));

    useEffect(() => {
        setIsSuspended(stats?.isSuspended || server.status === 'suspended');
    }, [stats?.isSuspended, server.status]);

    useEffect(() => {
        // Don't waste a HTTP request if there is nothing important to show to the user because
        // the server is suspended.
        if (isSuspended) return;

        getStats().then(() => {
            interval.current = setInterval(() => getStats(), 30000);
        });

        return () => {
            interval.current && clearInterval(interval.current);
        };
    }, [isSuspended]);

    const cpuUsed =
        server.limits.cpu === 0 ? stats?.cpuUsagePercent : (stats?.cpuUsagePercent ?? 0) / (server.limits.cpu / 100);
    const diskUsed = ((stats?.diskUsageInBytes ?? 0) / 1024 / 1024 / server.limits.disk) * 100;
    const memoryUsed = ((stats?.memoryUsageInBytes ?? 0) / 1024 / 1024 / server.limits.memory) * 100;

    return (
        <>
            <div
                className={'mb-2 grid w-full grid-cols-[auto_1fr] overflow-hidden rounded-lg p-4 lg:grid-cols-12'}
                style={{ backgroundColor: colors.background }}
            >
                <FontAwesomeIcon
                    className={classNames(statusToColor(stats?.status ?? 'offline'), 'col-span-1 my-auto ml-4')}
                    icon={server.status === 'suspended' ? faXmarkCircle : faPowerOff}
                    size={'lg'}
                />
                <Link
                    to={`/server/${server.id}`}
                    className="col-span-1 mb-4 min-w-0 text-center text-white transition duration-300 hover:brightness-150 lg:col-span-6 lg:mb-0 lg:text-left"
                >
                    <div className={'truncate'}>{server.name}</div>
                    <div className={'my-auto text-xs text-gray-500'}>
                        {server.allocations[0]?.ip.toString()}:{server.allocations[0]?.port.toString()}
                    </div>
                </Link>
                <div className={'col-span-full my-auto mr-2 flex flex-wrap gap-1 lg:col-span-2'}>
                    {visibleGroups.map(group => (
                        <Pill size={'small'} type={'unknown'} key={group.id}>
                            <span style={{ color: group.color }} className={'ml-3 cursor-default'}>
                                {group.name}
                                <div
                                    onClick={() => onDelete(group.id)}
                                    className={'inline-flex opacity-0 transition duration-200 hover:opacity-100'}
                                >
                                    <FontAwesomeIcon icon={faTrash} size={'xs'} color={'red'} className={'ml-1'} />
                                </div>
                            </span>
                        </Pill>
                    ))}
                    <div
                        onClick={() => setOpen({ open: 'add', serverId: server.uuid, serverGroupIds: visibleGroups.map(g => g.id) })}
                        className={
                            'py-0.25 hidden cursor-pointer rounded-full border border-dashed border-gray-400 px-2 text-2xs font-medium leading-5 text-gray-500 transition duration-300 hover:bg-white/10 hover:text-white xl:inline-flex'
                        }
                    >
                        <FontAwesomeIcon icon={faPlus} className={'my-auto mr-1'} />
                        Add Group
                    </div>
                </div>
                {isSuspended || server.status === 'offline' || (stats?.status ?? 'offline') === 'offline' ? (
                    <UtilBox rounded={'full'} utilised={-1} icon={faInfoCircle} server={server} />
                ) : (
                    <>
                        <UtilBox rounded={'left'} utilised={Number(cpuUsed?.toFixed(0))} icon={faMicrochip} />
                        <UtilBox utilised={Number(memoryUsed.toFixed(0))} icon={faMemory} />
                        <UtilBox rounded={'right'} utilised={Number(diskUsed.toFixed(0))} icon={faFloppyDisk} />
                    </>
                )}
            </div>
        </>
    );
};

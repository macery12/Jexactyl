import { useEffect, useRef, useState } from 'react';
import * as React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faLock, faPause, faPlus, faTrash } from '@fortawesome/free-solid-svg-icons';
import { Link } from 'react-router-dom';
import { ServerPowerState, ServerStats, type Server } from '@definitions/server';
import { getServerResourceUsage } from '@/api/routes/server';
import { ServerStatus } from '@/api/routes/server';
import classNames from 'classnames';
import { removeServerFromGroup } from '@/api/routes/server/groups';
import { type ServerGroup } from '@definitions/server';
import { VisibleDialog } from './groups/ServerGroupDialog';
import useFlash from '@/plugins/useFlash';

type Timer = ReturnType<typeof setInterval>;

const StatusDot = ({
    powerState,
    serverStatus,
    isTransferring,
}: {
    powerState?: ServerPowerState;
    serverStatus?: ServerStatus;
    isTransferring?: boolean;
}) => {
    if (serverStatus === 'suspended') {
        return <span className="h-2 w-2 flex-shrink-0 rounded-full bg-orange-400" />;
    }
    if (serverStatus === 'installing' || serverStatus === 'restoring_backup') {
        return <span className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-blue-400" />;
    }
    if (serverStatus === 'install_failed' || serverStatus === 'reinstall_failed') {
        return <span className="h-2 w-2 flex-shrink-0 rounded-full bg-red-500" />;
    }
    if (isTransferring) {
        return <span className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-purple-400" />;
    }
    switch (powerState) {
        case 'running':
            return <span className="h-2 w-2 flex-shrink-0 rounded-full bg-green-500" />;
        case 'starting':
        case 'stopping':
            return <span className="h-2 w-2 flex-shrink-0 animate-pulse rounded-full bg-yellow-500" />;
        default:
            return <span className="h-2 w-2 flex-shrink-0 rounded-full bg-red-500" />;
    }
};

const StatusBadge = ({
    powerState,
    serverStatus,
    isTransferring,
}: {
    powerState?: ServerPowerState;
    serverStatus?: ServerStatus;
    isTransferring?: boolean;
}) => {
    const base = 'inline-flex flex-shrink-0 items-center rounded-full px-2 py-0.5 text-2xs font-medium border';

    if (serverStatus === 'suspended') {
        return <span className={classNames(base, 'border-orange-500/30 bg-orange-500/10 text-orange-400')}>Suspended</span>;
    }
    if (serverStatus === 'installing') {
        return <span className={classNames(base, 'border-blue-500/30 bg-blue-500/10 text-blue-400')}>Installing</span>;
    }
    if (serverStatus === 'restoring_backup') {
        return <span className={classNames(base, 'border-blue-500/30 bg-blue-500/10 text-blue-400')}>Restoring</span>;
    }
    if (serverStatus === 'install_failed' || serverStatus === 'reinstall_failed') {
        return <span className={classNames(base, 'border-red-500/30 bg-red-500/10 text-red-400')}>Failed</span>;
    }
    if (isTransferring) {
        return <span className={classNames(base, 'border-purple-500/30 bg-purple-500/10 text-purple-400')}>Transferring</span>;
    }
    switch (powerState) {
        case 'running':
            return <span className={classNames(base, 'border-green-500/30 bg-green-500/10 text-green-400')}>Online</span>;
        case 'starting':
            return <span className={classNames(base, 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400')}>Starting</span>;
        case 'stopping':
            return <span className={classNames(base, 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400')}>Stopping</span>;
        default:
            return <span className={classNames(base, 'border-red-500/30 bg-red-500/10 text-red-400')}>Offline</span>;
    }
};

const NodeBadge = ({
    node,
    underMaintenance,
    supercharged,
}: {
    node: string;
    underMaintenance: boolean;
    supercharged: boolean;
}) => (
    <span
        className={classNames(
            'inline-flex items-center rounded-full px-2 py-0.5 text-2xs font-medium',
            underMaintenance
                ? 'border border-yellow-700/50 bg-yellow-900/30 text-yellow-400'
                : supercharged
                  ? 'border border-indigo-700/50 bg-indigo-900/30 text-indigo-300'
                  : 'border border-gray-700 bg-black/30 text-gray-500',
        )}
    >
        {node}
    </span>
);

const ResourceBar = ({
    label,
    value,
    color,
    isOffline,
}: {
    label: string;
    value: number;
    color: string;
    isOffline: boolean;
}) => {
    const blank = isOffline || !isFinite(value) || isNaN(value);
    const pct = blank ? 0 : Math.round(Math.max(0, Math.min(100, value)));

    return (
        <div>
            <div className="mb-1 flex items-center justify-between">
                <span className="text-2xs uppercase tracking-wide text-gray-600">{label}</span>
                <span className="text-2xs font-medium text-gray-400">{blank ? '—' : `${pct}%`}</span>
            </div>
            <div className="h-1 rounded-full bg-gray-800">
                <div
                    className={classNames('h-1 rounded-full transition-all duration-700', color)}
                    style={{ width: `${pct}%` }}
                />
            </div>
        </div>
    );
};

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
    const interval = useRef<Timer>(null) as React.MutableRefObject<Timer>;
    const [isSuspended, setIsSuspended] = useState(server.status === 'suspended');
    const [removedGroupIds, setRemovedGroupIds] = useState<number[]>([]);

    const visibleGroups = groups.filter(g => !removedGroupIds.includes(g.id));

    const onGroupDelete = (e: React.MouseEvent, groupId: number) => {
        e.preventDefault();
        e.stopPropagation();
        clearFlashes();
        removeServerFromGroup(groupId, server.uuid)
            .then(() => {
                addFlash({ type: 'success', key: 'dashboard:groups', message: 'Server group removed successfully.' });
                setRemovedGroupIds(prev => [...prev, groupId]);
            })
            .catch(error => clearAndAddHttpError({ key: 'dashboard:groups', error }));
    };

    const onGroupAdd = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setOpen({ open: 'add', serverId: server.uuid, serverGroupIds: visibleGroups.map(g => g.id) });
    };

    const getStats = () =>
        getServerResourceUsage(server.uuid)
            .then(data => setStats(data))
            .catch(err => console.error(err));

    useEffect(() => {
        setIsSuspended(stats?.isSuspended || server.status === 'suspended');
    }, [stats?.isSuspended, server.status]);

    useEffect(() => {
        if (isSuspended) return;
        getStats().then(() => {
            interval.current = setInterval(() => getStats(), 30000);
        });
        return () => { interval.current && clearInterval(interval.current); };
    }, [isSuspended]);

    const cpuUsed =
        server.limits.cpu === 0
            ? (stats?.cpuUsagePercent ?? 0)
            : (stats?.cpuUsagePercent ?? 0) / (server.limits.cpu / 100);
    const diskUsed =
        server.limits.disk > 0
            ? ((stats?.diskUsageInBytes ?? 0) / 1024 / 1024 / server.limits.disk) * 100
            : Infinity;
    const memoryUsed =
        server.limits.memory > 0
            ? ((stats?.memoryUsageInBytes ?? 0) / 1024 / 1024 / server.limits.memory) * 100
            : Infinity;

    const isOffline =
        isSuspended ||
        server.status === 'installing' ||
        server.status === 'restoring_backup' ||
        server.status === 'install_failed' ||
        server.status === 'reinstall_failed' ||
        server.isTransferring ||
        (stats?.status ?? 'offline') === 'offline';

    const ip = server.allocations[0]?.ip;
    const port = server.allocations[0]?.port;

    return (
        <Link
            to={`/server/${server.id}`}
            className="flex flex-col rounded-lg border border-gray-800 bg-black/30 p-4 transition-all duration-150 hover:border-gray-600 hover:bg-white/5"
        >
            {/* Header: status dot + name | status badge */}
            <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                    <StatusDot
                        powerState={stats?.status}
                        serverStatus={server.status}
                        isTransferring={server.isTransferring}
                    />
                    <span className="truncate text-sm font-semibold text-white">{server.name}</span>
                </div>
                <StatusBadge
                    powerState={stats?.status}
                    serverStatus={server.status}
                    isTransferring={server.isTransferring}
                />
            </div>

            {/* Address */}
            {ip && (
                <div className="mt-1 text-xs text-gray-600">
                    {ip}:{port}
                </div>
            )}

            {/* Pills: node + group + warnings */}
            <div className="mt-2 flex flex-wrap gap-1">
                <NodeBadge
                    node={server.node}
                    underMaintenance={server.isNodeUnderMaintenance}
                    supercharged={server.isNodeSupercharged}
                />
                {visibleGroups.map(group => (
                    <span
                        key={group.id}
                        className="inline-flex items-center gap-1 rounded-full border border-gray-700 bg-black/30 px-2 py-0.5 text-2xs font-medium"
                        style={{ color: group.color }}
                    >
                        {group.name}
                        <span
                            onClick={e => onGroupDelete(e, group.id)}
                            className="cursor-pointer text-red-900 transition-colors hover:text-red-600"
                        >
                            <FontAwesomeIcon icon={faTrash} size="xs" />
                        </span>
                    </span>
                ))}
                <span
                    onClick={onGroupAdd}
                    className="inline-flex cursor-pointer items-center gap-1 rounded-full border border-dashed border-gray-700 px-2 py-0.5 text-2xs font-medium text-gray-600 transition-colors hover:border-gray-500 hover:text-gray-400"
                >
                    <FontAwesomeIcon icon={faPlus} size="xs" />
                    Add
                </span>
                {server.isDeletionScheduled && (
                    <span className="inline-flex items-center rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-2xs font-medium text-red-400">
                        Deletion scheduled
                    </span>
                )}
            </div>

            {/* Resource bars — pinned to bottom */}
            <div className="mt-auto pt-3">
                <div className="mb-3 border-t border-gray-800" />
                <div className="relative">
                    <div className={classNames('grid grid-cols-3 gap-3', isOffline && 'opacity-30')}>
                        <ResourceBar label="CPU" value={cpuUsed} color="bg-indigo-500" isOffline={isOffline} />
                        <ResourceBar label="RAM" value={memoryUsed} color="bg-emerald-500" isOffline={isOffline} />
                        <ResourceBar label="Disk" value={diskUsed} color="bg-amber-500" isOffline={isOffline} />
                    </div>
                    {isOffline && (
                        <div className="absolute inset-0 flex items-center justify-center">
                            <FontAwesomeIcon
                                icon={isSuspended || server.status === 'suspended' ? faLock : faPause}
                                className="text-gray-500"
                                size="lg"
                            />
                        </div>
                    )}
                </div>
            </div>
        </Link>
    );
};

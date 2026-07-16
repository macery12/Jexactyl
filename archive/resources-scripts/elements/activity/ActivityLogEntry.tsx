import * as React from 'react';
import { Link } from 'react-router-dom';
import Tooltip from '@/elements/tooltip/Tooltip';
import Translate from '@/elements/Translate';
import { format, formatDistanceToNowStrict } from 'date-fns';
import { ActivityLog } from '@definitions/account';
import ActivityLogMetaButton from '@/elements/activity/ActivityLogMetaButton';
import FileDiffViewer, { FileDiff } from '@/elements/activity/FileDiffViewer';
import { FolderOpenIcon, TerminalIcon } from '@heroicons/react/solid';
import classNames from 'classnames';
import style from './style.module.css';
import Avatar from '@/elements/Avatar';
import useLocationHash from '@/plugins/useLocationHash';
import { getObjectKeys, isObject } from '@/lib/objects';
import { useStoreState } from '@/state/hooks';

interface Props {
    activity: ActivityLog;
    children?: React.ReactNode;
}

function wrapProperties(value: unknown): any {
    if (value === null || typeof value === 'string' || typeof value === 'number') {
        return `<strong>${String(value)}</strong>`;
    }

    if (isObject(value)) {
        return getObjectKeys(value).reduce(
            (obj, key) => {
                if (key === 'count' || (typeof key === 'string' && key.endsWith('_count'))) {
                    return { ...obj, [key]: value[key] };
                }
                return { ...obj, [key]: wrapProperties(value[key]) };
            },
            {} as Record<string, unknown>,
        );
    }

    if (Array.isArray(value)) {
        return value.map(wrapProperties);
    }

    return value;
}

function hasFileDiff(activity: ActivityLog): boolean {
    return (
        (activity.event === 'server:file.write' || activity.event === 'server:sftp.write') &&
        activity.properties?.diff !== undefined &&
        typeof activity.properties.diff === 'object'
    );
}

function getFileDiff(activity: ActivityLog): FileDiff | null {
    if (!hasFileDiff(activity)) return null;

    const diff = activity.properties.diff as Record<string, unknown>;
    const fileFromFiles = Array.isArray(activity.properties.files)
        ? (activity.properties.files[0] as string | undefined)
        : undefined;

    return {
        file: (activity.properties.file as string | undefined) || fileFromFiles,
        additions: (diff.additions as number) || 0,
        deletions: (diff.deletions as number) || 0,
        hunks: (diff.hunks as FileDiff['hunks']) || [],
        is_new_file: (diff.is_new_file as boolean) || false,
        large_file: (diff.large_file as boolean) || false,
    };
}

function getCommand(activity: ActivityLog): string | null {
    if (typeof activity.properties?.command !== 'string') {
        return null;
    }

    if (activity.event !== 'server:console.command' && activity.event !== 'server:ssh.command') {
        return null;
    }

    return activity.properties.command;
}

export default ({ activity, children }: Props) => {
    const { pathTo } = useLocationHash();
    const actor = activity.relationships.actor;
    const properties = wrapProperties(activity.properties);
    const { colors } = useStoreState(state => state.theme.data!);
    const fileDiff = getFileDiff(activity);
    const command = getCommand(activity);

    return (
        <div
            className={
                'group grid grid-cols-10 py-5 px-4 last:rounded-b last:border-0 border-b border-slate-600/50 hover:bg-slate-600/30 transition-colors duration-150'
            }
            style={{ backgroundColor: colors.secondary }}
        >
            {/* Avatar Column - Always visible on larger screens */}
            <div className={'hidden items-center justify-center pl-2 sm:col-span-1 sm:flex 2xl:col-span-1'}>
                <div
                    className={
                        'mr-2 flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-600 ring-1 ring-slate-500/50'
                    }
                >
                    <Avatar name={actor?.uuid || 'system'} size={'100%'} />
                </div>
            </div>

            {/* Content Column */}
            <div className={'col-span-10 flex flex-col sm:col-span-9 sm:pl-3'}>
                <div className={'flex flex-col space-y-2'}>
                    {/* Main Info Row */}
                    <div className={'flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2'}>
                        <div className={'flex-1 min-w-0'}>
                            {/* User and Action */}
                            <div className={'flex flex-wrap items-center gap-x-3 gap-y-2'}>
                                <div className={'flex min-w-0 items-center gap-2 pr-1'}>
                                    {/* Mobile Avatar */}
                                    <div
                                        className={
                                            'mr-2 flex h-8 w-8 flex-shrink-0 items-center justify-center overflow-hidden rounded-full bg-slate-600 sm:hidden'
                                        }
                                    >
                                        <Avatar name={actor?.uuid || 'system'} size={'100%'} />
                                    </div>
                                    <Tooltip placement={'top'} content={actor?.email || 'System User'}>
                                        <span className={'truncate font-semibold text-slate-50 text-base'}>
                                            {actor?.username || 'System'}
                                        </span>
                                    </Tooltip>
                                </div>
                                <div className={classNames(style.icons, 'flex-shrink-0 group-hover:text-slate-300')}>
                                    {activity.isApi && (
                                        <Tooltip placement={'top'} content={'Using API Key'}>
                                            <TerminalIcon />
                                        </Tooltip>
                                    )}
                                    {activity.event.startsWith('server:sftp.') && (
                                        <Tooltip placement={'top'} content={'Using SFTP'}>
                                            <FolderOpenIcon />
                                        </Tooltip>
                                    )}
                                    {activity.event.startsWith('server:ssh.') && (
                                        <Tooltip placement={'top'} content={'Using SSH'}>
                                            <TerminalIcon />
                                        </Tooltip>
                                    )}
                                    {activity.properties?.source === 'ssh' &&
                                        !activity.event.startsWith('server:ssh.') && (
                                            <Tooltip placement={'top'} content={'Via SSH'}>
                                                <TerminalIcon />
                                            </Tooltip>
                                        )}
                                    {children}
                                </div>
                                <div className={'flex flex-wrap items-center gap-2 pl-1'}>
                                    {activity.context === 'admin' && (
                                        <span
                                            className={
                                                'rounded-full border border-red-400/40 bg-red-500/10 px-2 py-0.5 text-xs uppercase tracking-wide text-red-200'
                                            }
                                        >
                                            Admin
                                        </span>
                                    )}
                                    {activity.isApi && (
                                        <span
                                            className={
                                                'rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-0.5 text-xs uppercase tracking-wide text-emerald-200'
                                            }
                                        >
                                            API
                                        </span>
                                    )}
                                    {activity.category && (
                                        <span
                                            className={
                                                'rounded-full border border-slate-400/30 bg-slate-600/60 px-2 py-0.5 text-xs uppercase tracking-wide text-slate-200'
                                            }
                                        >
                                            {activity.category}
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Action Description */}
                            <div className={'mt-1.5'}>
                                <Link
                                    to={`#${pathTo({ event: activity.event })}`}
                                    className={
                                        'font-medium text-slate-200 transition-colors duration-75 hover:text-cyan-400 active:text-cyan-400'
                                    }
                                >
                                    {activity.description ?? activity.event}
                                </Link>
                            </div>

                            {/* Activity Details */}
                            <p className={classNames(style.description, 'mt-1')}>
                                <Translate
                                    ns={'activity'}
                                    values={properties}
                                    i18nKey={activity.event.replace(':', '.')}
                                />
                            </p>

                            {fileDiff && (
                                <div className="mt-2 text-xs text-slate-400">
                                    <span className="text-green-400">+{fileDiff.additions}</span>
                                    <span className="mx-1">/</span>
                                    <span className="text-red-400">-{fileDiff.deletions}</span>
                                    <span className="ml-1">lines changed</span>
                                </div>
                            )}

                            {command && (
                                <div className="mt-2 rounded bg-slate-900/70 border border-slate-700 px-2 py-1 text-xs font-mono text-slate-200 break-all">
                                    {command}
                                </div>
                            )}
                        </div>

                        {/* Timestamp - Right aligned on desktop */}
                        <div className={'flex-shrink-0'}>
                            <Tooltip placement={'top'} content={format(activity.timestamp, 'MMM do, yyyy H:mm:ss')}>
                                <span className={'text-sm text-slate-400'}>
                                    {formatDistanceToNowStrict(activity.timestamp, { addSuffix: true })}
                                </span>
                            </Tooltip>
                        </div>
                    </div>

                    {/* Secondary Info Row */}
                    <div className={'flex items-center justify-between text-xs text-slate-500'}>
                        <div className={'flex items-center gap-2'}>
                            {activity.ip && (
                                <span className={'font-mono bg-slate-700/50 px-2 py-0.5 rounded'}>{activity.ip}</span>
                            )}
                            {activity.id && <span className={'text-slate-600'}>ID: {activity.id.substring(0, 8)}</span>}
                        </div>
                        {activity.hasAdditionalMetadata && <ActivityLogMetaButton meta={activity.properties} />}
                    </div>
                </div>

                {/* File Diff */}
                {fileDiff && (
                    <div className="mt-3">
                        <FileDiffViewer diff={fileDiff} />
                    </div>
                )}
            </div>
        </div>
    );
};

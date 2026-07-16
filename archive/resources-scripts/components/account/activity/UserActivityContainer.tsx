import { useEffect, useState } from 'react';
import tw from 'twin.macro';
import { XCircleIcon, FilterIcon, ServerIcon } from '@heroicons/react/solid';
import PageContentBlock from '@/elements/PageContentBlock';
import ContentBox from '@/elements/ContentBox';
import FlashMessageRender from '@/elements/FlashMessageRender';
import Spinner from '@/elements/Spinner';
import PaginationFooter from '@/elements/table/PaginationFooter';
import ActivityLogEntry from '@/elements/activity/ActivityLogEntry';
import { useFlashKey } from '@/plugins/useFlash';
import { ActivityLogFilters, useActivityLogs, useOwnedServers } from '@/api/routes/account/activity';
import useLocationHash from '@/plugins/useLocationHash';
import classNames from 'classnames';

type ScopeFilter = 'all' | 'account' | 'server';

export default () => {
    const { hash } = useLocationHash();
    const { clearAndAddHttpError } = useFlashKey('account:activity');

    const [scope, setScope] = useState<ScopeFilter>('all');
    const [selectedServer, setSelectedServer] = useState<string>('');
    const [eventFilter, setEventFilter] = useState<string>('');
    const [filters, setFilters] = useState<ActivityLogFilters>({
        page: 1,
        sorts: { timestamp: -1 },
    });

    const { data: ownedServers } = useOwnedServers();
    const { data, isValidating, error } = useActivityLogs(filters, {
        revalidateOnMount: true,
        revalidateOnFocus: false,
    });

    useEffect(() => {
        if (hash.event) setEventFilter(hash.event as string);
    }, [hash]);

    useEffect(() => {
        clearAndAddHttpError(error);
    }, [error]);

    useEffect(() => {
        const newFilters: ActivityLogFilters['filters'] = {};
        if (scope !== 'all') newFilters.scope = scope;
        if (selectedServer) newFilters.server = selectedServer;
        if (eventFilter) newFilters.event = eventFilter;

        setFilters(prev => ({ ...prev, page: 1, filters: newFilters }));
    }, [scope, selectedServer, eventFilter]);

    const hasFilters = scope !== 'all' || !!selectedServer || !!eventFilter;

    function clearFilters() {
        setScope('all');
        setSelectedServer('');
        setEventFilter('');
    }

    const scopeButtons: { label: string; value: ScopeFilter }[] = [
        { label: 'All', value: 'all' },
        { label: 'Account', value: 'account' },
        { label: 'Server', value: 'server' },
    ];

    return (
        <PageContentBlock title="Activity" showFlashKey="account:activity">
            <FlashMessageRender byKey="account:activity" css={tw`mb-4`} />

            <ContentBox title="Activity Log">
                {/* Filter Bar */}
                <div css={tw`flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between`}>
                    <div css={tw`flex flex-wrap items-center gap-2`}>
                        {/* Scope Toggle */}
                        <div css={tw`flex rounded-lg overflow-hidden border border-slate-600`}>
                            {scopeButtons.map(btn => (
                                <button
                                    key={btn.value}
                                    onClick={() => {
                                        setScope(btn.value);
                                        if (btn.value === 'account') setSelectedServer('');
                                    }}
                                    css={tw`px-3 py-1.5 text-sm font-medium transition-colors`}
                                    className={classNames(
                                        scope === btn.value
                                            ? 'bg-indigo-600 text-white'
                                            : 'bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white',
                                    )}
                                >
                                    {btn.label}
                                </button>
                            ))}
                        </div>

                        {/* Server Dropdown */}
                        {scope !== 'account' && ownedServers && ownedServers.length > 0 && (
                            <div css={tw`flex items-center gap-1.5`}>
                                <ServerIcon css={tw`w-4 h-4 text-slate-400 flex-shrink-0`} />
                                <select
                                    value={selectedServer}
                                    onChange={e => setSelectedServer(e.target.value)}
                                    css={tw`bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500`}
                                >
                                    <option value="">All servers</option>
                                    {ownedServers.map(server => (
                                        <option key={server.uuid} value={server.uuid}>
                                            {server.name}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        )}

                        {/* Event Filter */}
                        <div css={tw`flex items-center gap-1.5`}>
                            <FilterIcon css={tw`w-4 h-4 text-slate-400 flex-shrink-0`} />
                            <input
                                type="text"
                                placeholder="Filter by event..."
                                value={eventFilter}
                                onChange={e => setEventFilter(e.target.value)}
                                css={tw`bg-slate-700 border border-slate-600 text-slate-200 text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder-slate-500`}
                            />
                        </div>
                    </div>

                    {/* Clear Filters */}
                    {hasFilters && (
                        <button
                            onClick={clearFilters}
                            css={tw`flex items-center gap-1.5 text-sm text-slate-400 hover:text-slate-200 transition-colors self-start sm:self-auto`}
                        >
                            <XCircleIcon css={tw`w-4 h-4`} />
                            Clear filters
                        </button>
                    )}
                </div>

                {/* Activity List */}
                {!data && isValidating ? (
                    <Spinner centered />
                ) : !data?.items.length ? (
                    <p css={tw`text-sm text-slate-400 text-center py-8`}>No activity found.</p>
                ) : (
                    <div css={tw`bg-slate-700 rounded`}>
                        {data.items.map(activity => (
                            <ActivityLogEntry key={activity.id} activity={activity} />
                        ))}
                    </div>
                )}

                {data && (
                    <PaginationFooter
                        pagination={data.pagination}
                        onPageSelect={page => setFilters(prev => ({ ...prev, page }))}
                    />
                )}
            </ContentBox>
        </PageContentBlock>
    );
};

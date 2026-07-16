import { useEffect, useMemo, useState } from 'react';
import { useActivityLogs, getActivityUsers, getActivityEvents } from '@/api/routes/server/activity';
import { useFlashKey } from '@/plugins/useFlash';
import FlashMessageRender from '@/elements/FlashMessageRender';
import Spinner from '@/elements/Spinner';
import ActivityLogEntry from '@/elements/activity/ActivityLogEntry';
import PaginationFooter from '@/elements/table/PaginationFooter';
import { ActivityLogFilters } from '@/api/routes/server/activity';
import { Link } from 'react-router-dom';
import classNames from 'classnames';
import { styles as btnStyles } from '@/elements/button/index';
import { XCircleIcon, SearchIcon } from '@heroicons/react/solid';
import useLocationHash from '@/plugins/useLocationHash';
import PageContentBlock from '@/elements/PageContentBlock';
import { useStoreState } from '@/state/hooks';
import Input from '@/elements/Input';
import Select from '@/elements/Select';
import debounce from 'debounce';
import { ServerContext } from '@/state/server';

export default () => {
    const { hash } = useLocationHash();
    const { clearAndAddHttpError } = useFlashKey('server:activity');
    const uuid = ServerContext.useStoreState(state => state.server.data?.uuid);

    // Filter states that will be sent to backend
    const [searchInput, setSearchInput] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedUser, setSelectedUser] = useState<string>('');
    const [selectedEventType, setSelectedEventType] = useState<string>('');
    const [sortOrder, setSortOrder] = useState<'-timestamp' | 'timestamp'>('-timestamp');
    const [currentPage, setCurrentPage] = useState(1);

    // All users and events (loaded from backend)
    const [allUsers, setAllUsers] = useState<Array<{ uuid: string; username: string }>>([]);
    const [allEvents, setAllEvents] = useState<string[]>([]);
    const [isLoadingMetadata, setIsLoadingMetadata] = useState(true);

    const enabled = useStoreState(state => state.settings.data!.activity.enabled.server);

    // Build filters for API
    const filters = useMemo<ActivityLogFilters>(() => {
        const f: ActivityLogFilters = {
            page: currentPage,
            sorts: { timestamp: sortOrder === '-timestamp' ? -1 : 1 },
            filters: {},
        };

        // Add hash filters if present
        if (hash.ip) f.filters!.ip = hash.ip;
        if (hash.event) f.filters!.event = hash.event;

        if (searchQuery.trim()) {
            f.filters!.search = searchQuery;
        }

        if (selectedUser) {
            f.filters!.actor = selectedUser;
        }

        if (selectedEventType) {
            f.filters!.event = selectedEventType;
        }

        return f;
    }, [searchQuery, selectedUser, selectedEventType, sortOrder, currentPage, hash]);

    const { data, isValidating, error } = useActivityLogs(filters, {
        revalidateOnMount: true,
        revalidateOnFocus: false,
    });

    if (!enabled) return <></>;

    // Load all users and events on mount
    useEffect(() => {
        if (!uuid) return;

        const loadMetadata = async () => {
            try {
                const [users, events] = await Promise.all([getActivityUsers(uuid), getActivityEvents(uuid)]);
                setAllUsers(users);
                setAllEvents(events);
            } catch (err) {
                console.error('Failed to load activity metadata:', err);
            } finally {
                setIsLoadingMetadata(false);
            }
        };
        loadMetadata();
    }, [uuid]);

    useEffect(() => {
        clearAndAddHttpError(error);
    }, [error]);

    // Debounced search handler
    const debouncedSetSearchQuery = useMemo(
        () =>
            debounce((value: string) => {
                setSearchQuery(value);
            }, 300),
        [],
    );

    // Update search query when input changes
    useEffect(() => {
        debouncedSetSearchQuery(searchInput);
    }, [searchInput, debouncedSetSearchQuery]);

    // Cleanup debounced function on unmount
    useEffect(() => {
        return () => {
            debouncedSetSearchQuery.clear();
        };
    }, [debouncedSetSearchQuery]);

    const clearFilters = () => {
        setSearchInput('');
        setSearchQuery('');
        setSelectedUser('');
        setSelectedEventType('');
        setSortOrder('-timestamp');
        setCurrentPage(1);
    };

    // Reset to page 1 when filters change
    useEffect(() => {
        setCurrentPage(1);
    }, [searchQuery, selectedUser, selectedEventType, sortOrder]);

    const hasActiveFilters =
        searchInput.trim() !== '' || selectedUser !== '' || selectedEventType !== '' || sortOrder !== '-timestamp';

    return (
        <PageContentBlock title={'Activity Log'} header description={'View recent activity on your server.'}>
            <FlashMessageRender byKey={'server:activity'} />

            {/* Filter Toolbar */}
            <div className={'mb-4 space-y-3'}>
                <div className={'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4'}>
                    {/* Search Input */}
                    <div className={'relative'}>
                        <div className={'pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3'}>
                            <SearchIcon className={'h-5 w-5 text-neutral-400'} />
                        </div>
                        <Input
                            type={'text'}
                            placeholder={'Search activity...'}
                            className={'!pl-11'}
                            value={searchInput}
                            onChange={e => setSearchInput(e.currentTarget.value)}
                        />
                    </div>

                    {/* User Filter */}
                    <Select
                        value={selectedUser}
                        onChange={e => setSelectedUser(e.currentTarget.value)}
                        disabled={isLoadingMetadata}
                    >
                        <option value={''}>All Users</option>
                        {allUsers.map(user => (
                            <option key={user.uuid} value={user.uuid}>
                                {user.username}
                            </option>
                        ))}
                    </Select>

                    {/* Event Type Filter */}
                    <Select
                        value={selectedEventType}
                        onChange={e => setSelectedEventType(e.currentTarget.value)}
                        disabled={isLoadingMetadata}
                    >
                        <option value={''}>All Event Types</option>
                        {allEvents.map(event => (
                            <option key={event} value={event}>
                                {event}
                            </option>
                        ))}
                    </Select>

                    {/* Sort Order */}
                    <Select
                        value={sortOrder}
                        onChange={e => {
                            const value = e.currentTarget.value;
                            if (value === '-timestamp' || value === 'timestamp') {
                                setSortOrder(value);
                            }
                        }}
                    >
                        <option value={'-timestamp'}>Newest First</option>
                        <option value={'timestamp'}>Oldest First</option>
                    </Select>
                </div>

                {/* Clear Filters Button */}
                {hasActiveFilters && (
                    <div className={'flex justify-end'}>
                        <Link
                            to={'#'}
                            className={classNames(btnStyles.button, btnStyles.text, 'w-full sm:w-auto')}
                            onClick={clearFilters}
                        >
                            Clear All Filters <XCircleIcon className={'ml-2 h-4 w-4'} />
                        </Link>
                    </div>
                )}
            </div>

            {/* Activity List */}
            {isValidating ? (
                <Spinner centered />
            ) : (
                <div className={'bg-slate-700'}>
                    {data?.items && data.items.length > 0 ? (
                        <>
                            {data.items.map(activity => (
                                <ActivityLogEntry key={activity.id} activity={activity}>
                                    <span />
                                </ActivityLogEntry>
                            ))}
                        </>
                    ) : (
                        <div className={'py-12 text-center'}>
                            <p className={'text-lg font-medium text-neutral-50'}>No activity found</p>
                            <p className={'mt-1 text-sm text-neutral-400'}>
                                {hasActiveFilters
                                    ? 'Try adjusting your filters to see more results.'
                                    : 'No activity logs available for this server.'}
                            </p>
                        </div>
                    )}
                </div>
            )}
            {data && data.items.length > 0 && (
                <PaginationFooter pagination={data.pagination} onPageSelect={page => setCurrentPage(page)} />
            )}
        </PageContentBlock>
    );
};

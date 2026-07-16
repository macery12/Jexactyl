import AdminContentBlock from '@/elements/AdminContentBlock';
import FlashMessageRender from '@/elements/FlashMessageRender';
import { useEffect, useMemo, useState } from 'react';
import { useFlashKey } from '@/plugins/useFlash';
import { Link } from 'react-router-dom';
import PaginationFooter from '@/elements/table/PaginationFooter';
import { DesktopComputerIcon, XCircleIcon, SearchIcon } from '@heroicons/react/solid';
import Spinner from '@/elements/Spinner';
import { styles as btnStyles } from '@/elements/button/index';
import classNames from 'classnames';
import ActivityLogEntry from '@/elements/activity/ActivityLogEntry';
import Tooltip from '@/elements/tooltip/Tooltip';
import useLocationHash from '@/plugins/useLocationHash';
import { ActivityLogFilters, useActivityLogs, getActivityUsers, getActivityEvents } from '@/api/routes/admin/activity';
import { useStoreState } from '@/state/hooks';
import Input from '@/elements/Input';
import Select from '@/elements/Select';
import debounce from 'debounce';

export default () => {
    const { hash } = useLocationHash();
    const { clearAndAddHttpError } = useFlashKey('account');

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

    const enabled: boolean = useStoreState(state => state.settings.data!.activity.enabled.admin);

    if (!enabled) return <></>;

    // Load all users and events on mount
    useEffect(() => {
        const loadMetadata = async () => {
            try {
                const [users, events] = await Promise.all([getActivityUsers(), getActivityEvents()]);
                setAllUsers(users);
                setAllEvents(events);
            } catch (err) {
                console.error('Failed to load activity metadata:', err);
            } finally {
                setIsLoadingMetadata(false);
            }
        };
        loadMetadata();
    }, []);

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
        <AdminContentBlock title={'Admin Activity'}>
            <FlashMessageRender byKey={'admin:activity'} className={'mb-4'} />
            <div className={'mb-6 flex w-full flex-row items-center'}>
                <div className={'flex flex-shrink flex-col'} style={{ minWidth: '0' }}>
                    <h2 className={'font-header text-2xl font-medium text-neutral-50'}>Admin Activity</h2>
                    <p
                        className={
                            'hidden overflow-hidden overflow-ellipsis whitespace-nowrap text-base text-neutral-400 lg:block'
                        }
                    >
                        Get detailed insights into what actions administrators are performing.
                    </p>
                </div>
            </div>

            {/* Filter Toolbar */}
            <div className={'mb-4 space-y-3'}>
                <div className={'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4'}>
                    {/* Search Input */}
                    <div className={'relative'}>
                        <div className={'absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none'}>
                            <SearchIcon className={'h-4 w-4 text-neutral-400'} />
                        </div>
                        <Input
                            type={'text'}
                            placeholder={'Search activity...'}
                            className={'!pl-10'}
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
                                    {typeof activity.properties.useragent === 'string' && (
                                        <Tooltip content={activity.properties.useragent} placement={'top'}>
                                            <span>
                                                <DesktopComputerIcon />
                                            </span>
                                        </Tooltip>
                                    )}
                                </ActivityLogEntry>
                            ))}
                        </>
                    ) : (
                        <div className={'py-12 text-center'}>
                            <p className={'text-lg font-medium text-neutral-50'}>No activity found</p>
                            <p className={'mt-1 text-sm text-neutral-400'}>
                                {hasActiveFilters
                                    ? 'Try adjusting your filters to see more results.'
                                    : 'There are no admin logs available at this time.'}
                            </p>
                        </div>
                    )}
                </div>
            )}
            {data && data.items.length > 0 && (
                <PaginationFooter pagination={data.pagination} onPageSelect={page => setCurrentPage(page)} />
            )}
        </AdminContentBlock>
    );
};

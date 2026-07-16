import { useEffect, useState } from 'react';
import { type Server } from '@definitions/server';
import getServers from '@/api/getServers';
import ServerCard from '@account/ServerCard';
import ServerSummaryBar from '@account/ServerSummaryBar';
import PageContentBlock from '@/elements/PageContentBlock';
import useFlash from '@/plugins/useFlash';
import { useStoreState } from 'easy-peasy';
import { usePersistedState } from '@/plugins/usePersistedState';
import tw from 'twin.macro';
import useSWR from 'swr';
import { PaginatedResult } from '@/api/http';
import Pagination from '@/elements/Pagination';
import { Link, useLocation } from 'react-router-dom';
import ContentBox from '@/elements/ContentBox';
import FlashMessageRender from '@/elements/FlashMessageRender';
import NotFoundSvg from '@/assets/images/not_found.svg';
import DashboardAlert from '@account/DashboardAlert';
import ServerSvg from '@/assets/images/themed/ServerSvg';
import { Button } from '@/elements/button';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCircleArrowRight, faList } from '@fortawesome/free-solid-svg-icons';
import { ViewGridIcon, ViewListIcon, PlusIcon } from '@heroicons/react/solid';
import { getServerGroups } from '@/api/routes/server/groups';
import { type ServerGroup } from '@definitions/server';
import ServerGroupDialog, { VisibleDialog } from '@account/groups/ServerGroupDialog';

const PER_PAGE = 10;

export default () => {
    const { search } = useLocation();
    const defaultPage = Number(new URLSearchParams(search).get('page') || '1');

    const [open, setOpen] = useState<VisibleDialog>({ open: 'none', serverId: undefined });
    const colors = useStoreState(state => state.theme.data!.colors);

    const [groups, setGroups] = useState<ServerGroup[]>([]);
    const [page, setPage] = useState(!isNaN(defaultPage) && defaultPage > 0 ? defaultPage : 1);
    const { clearFlashes, clearAndAddHttpError } = useFlash();
    const name = useStoreState(state => state.settings.data!.name);
    const uuid = useStoreState(state => state.user.data!.uuid);
    const user = useStoreState(state => state.user.data!);
    const billing = useStoreState(state => state.everest.data!.billing.enabled);
    const [viewMode, setViewMode] = usePersistedState<'grid' | 'list'>(`${uuid}:dashboard_view`, 'grid');

    const [pendingGroupIds, setPendingGroupIds] = useState<Record<string, number[]>>({});

    const onGroupAdded = (serverUuid: string, groupId: number) => {
        setPendingGroupIds(prev => ({
            ...prev,
            [serverUuid]: [...(prev[serverUuid] ?? []), groupId],
        }));
    };

    const { data: servers, error } = useSWR<PaginatedResult<Server>>(
        ['/api/client/servers', page],
        () => getServers({ page, per_page: PER_PAGE }),
    );

    useEffect(() => {
        getServerGroups()
            .then(data => setGroups(data))
            .catch(() => console.error());
    }, []);

    useEffect(() => {
        if (!servers) return;
        if (servers.pagination.currentPage > 1 && !servers.items.length) {
            setPage(1);
        }
    }, [servers?.pagination.currentPage]);

    useEffect(() => {
        window.history.replaceState(null, document.title, `/${page <= 1 ? '' : `?page=${page}`}`);
    }, [page]);

    useEffect(() => {
        if (error) clearAndAddHttpError({ key: 'dashboard', error });
        if (!error) clearFlashes('dashboard');
    }, [error]);

    return (
        <PageContentBlock title={`Welcome to ${name}`} header description={`Signed in as ${user.email}`}>
            <DashboardAlert />
            {open && <ServerGroupDialog open={open} setOpen={setOpen} groups={groups} setGroups={setGroups} onGroupAdded={onGroupAdded} />}
            <FlashMessageRender className={'my-4'} byKey={'dashboard'} />
            <FlashMessageRender className={'my-4'} byKey={'dashboard:groups'} />

            {servers && servers.items.length > 0 && (
                <ServerSummaryBar
                    servers={servers.items}
                    totalCount={servers.pagination.total}
                    billingEnabled={billing}
                    useTotp={user.useTotp}
                />
            )}

            <div>
                {/* Header row */}
                <div css={tw`mb-4 flex flex-wrap items-center justify-between gap-2 px-4`}>
                    {/* Left: title */}
                    <div css={tw`flex items-center gap-2`}>
                        <h2 css={tw`text-neutral-300 text-2xl font-semibold`}>
                            Your Servers
                        </h2>
                    </div>

                    {/* Right: view toggle + groups button */}
                    <div css={tw`flex items-center gap-2`}>
                        <div css={tw`flex rounded-lg border border-gray-700 overflow-hidden`}>
                            <button
                                onClick={() => setViewMode('list')}
                                css={tw`px-2.5 py-1.5 transition-colors duration-150`}
                                className={viewMode === 'list' ? 'bg-white/15 text-white' : 'text-gray-500 hover:text-gray-300'}
                                title="List view"
                            >
                                <ViewListIcon css={tw`w-4 h-4`} />
                            </button>
                            <button
                                onClick={() => setViewMode('grid')}
                                css={tw`px-2.5 py-1.5 transition-colors duration-150`}
                                className={viewMode === 'grid' ? 'bg-white/15 text-white' : 'text-gray-500 hover:text-gray-300'}
                                title="Grid view"
                            >
                                <ViewGridIcon css={tw`w-4 h-4`} />
                            </button>
                        </div>
                        <Button.Text
                            size={Button.Sizes.Small}
                            onClick={() => setOpen({ open: 'index' })}
                        >
                            <FontAwesomeIcon icon={faList} />
                        </Button.Text>
                    </div>
                </div>

                <ContentBox>
                    {!servers || servers.items.length < 1 ? (
                        <div className={'text-gray-400'}>
                            <div className={'m-4 grid gap-6 lg:grid-cols-2'}>
                                <ServerSvg color={colors.primary} />
                                <div>
                                    <h1 className={'text-2xl font-bold text-gray-200'}>Deploy your first server</h1>
                                    <div className={'mt-2'}>
                                        It looks like you have no servers deployed to your account.&nbsp;
                                        {billing ? (
                                            <>
                                                With our billing portal, you can configure and purchase a new server
                                                plan and choose options like amount of CPU, memory and which game
                                                you&apos;d like to run.
                                                <div className={'text-right'}>
                                                    <Link to={'/account/billing/order'}>
                                                        <Button
                                                            className={'w-full sm:w-1/2 font-normal text-white'}
                                                        >
                                                            View Options{' '}
                                                            <FontAwesomeIcon
                                                                icon={faCircleArrowRight}
                                                                className={'ml-2'}
                                                            />
                                                        </Button>
                                                    </Link>
                                                </div>
                                            </>
                                        ) : (
                                            <>Think this is a mistake? Please contact our support team.</>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <Pagination data={servers} onPageSelect={setPage}>
                            {({ items }) => {
                                const visibleItems = items.filter(s => s.serverOwner === true);
                                return visibleItems.length > 0 ? (
                                    <div
                                        className={
                                            viewMode === 'grid'
                                                ? 'grid grid-cols-1 gap-3 lg:grid-cols-2'
                                                : 'flex flex-col gap-2'
                                        }
                                    >
                                        {visibleItems.map(server => (
                                            <ServerCard
                                                key={server.uuid}
                                                server={server}
                                                setOpen={setOpen}
                                                groups={groups.filter(x => [...(server.groupIds ?? []), ...(pendingGroupIds[server.uuid] ?? [])].includes(x.id))}
                                            />
                                        ))}
                                        {billing && (
                                            <Link
                                                to="/account/billing/order"
                                                aria-label="Order a new server"
                                                className="flex flex-col items-center justify-center rounded-lg border border-dashed border-gray-700 p-4 text-center transition-all duration-150 hover:border-gray-500 hover:bg-white/5"
                                            >
                                                <div className="mb-1 rounded-full bg-gray-800 p-2.5">
                                                    <PlusIcon className="h-4 w-4 text-gray-400" />
                                                </div>
                                                <span className="text-sm font-medium text-gray-400">Order a new server</span>
                                                <span className="mt-0.5 text-xs text-gray-600">Deploy from marketplace</span>
                                            </Link>
                                        )}
                                    </div>
                                ) : (
                                    <div className={'w-full'} style={{ backgroundColor: colors.secondary }}>
                                        <div className={'px-6 py-4 text-gray-300'}>
                                            <div css={tw`flex justify-center`}>
                                                <div css={tw`w-full sm:w-3/4 md:w-1/2 rounded-lg text-center relative`}>
                                                    <img
                                                        src={NotFoundSvg}
                                                        css={tw`w-2/3 h-auto select-none mx-auto`}
                                                    />
                                                    <h2 css={tw`mt-10 mb-6 text-white font-medium text-xl`}>
                                                        No servers could be found.
                                                    </h2>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )
                            }}
                        </Pagination>
                    )}
                </ContentBox>
            </div>
        </PageContentBlock>
    );
};

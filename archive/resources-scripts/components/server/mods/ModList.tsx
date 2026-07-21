import tw from 'twin.macro';
import styled from 'styled-components';
import { type Mod } from '@/api/routes/server/mods';
import Spinner from '@/elements/Spinner';
import { Button } from '@/elements/button';
import FadeTransition from '@/elements/transitions/FadeTransition';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
    faAngleDoubleLeft,
    faAngleDoubleRight,
    faAngleLeft,
    faAngleRight,
    faDownload,
} from '@fortawesome/free-solid-svg-icons';
import { useStoreState } from '@/state/hooks';

interface Props {
    mods: Mod[];
    loading: boolean;
    contentType?: 'mods' | 'plugins';
    gameVersion?: string;
    pagination: {
        index: number;
        pageSize: number;
        resultCount: number;
        totalCount: number;
    };
    onModClick: (mod: Mod) => void;
    onPageChange: (index: number) => void;
}

const ModCard = styled.div<{ $backgroundColor: string }>`
    ${tw`rounded border border-neutral-700 cursor-pointer transition-colors duration-150`}
    background-color: ${props => props.$backgroundColor};

    &:hover {
        ${tw`border-neutral-600`}
        background-color: ${props => props.$backgroundColor}dd;
    }
`;

const ModHeader = styled.div`
    ${tw`flex items-start gap-3 p-3 border-b border-neutral-700/50`}
`;

const ModIcon = styled.img`
    ${tw`w-12 h-12 rounded flex-shrink-0 bg-neutral-900`}
`;

const ModInfo = styled.div`
    ${tw`flex-1 min-w-0`}
`;

const ModName = styled.h3`
    ${tw`text-sm font-semibold text-neutral-100 truncate mb-0.5`}
`;

const ModAuthor = styled.div`
    ${tw`text-xs text-neutral-400 truncate`}
`;

const ModStats = styled.div`
    ${tw`flex items-center gap-3 px-3 py-2 text-xs`}
`;

const StatItem = styled.div`
    ${tw`flex items-center gap-1.5 text-neutral-400`}
`;

const StatLabel = styled.span`
    ${tw`text-neutral-500`}
`;

const StatValue = styled.span`
    ${tw`text-neutral-300 font-medium`}
`;

const PaginationButton = styled(Button)`
    ${tw`p-0 w-10 h-10`}

    &:not(:last-of-type) {
        ${tw`mr-2`};
    }
`;

export default ({ mods, loading, contentType = 'mods', gameVersion, pagination, onModClick, onPageChange }: Props) => {
    const { background } = useStoreState(state => state.theme.data!.colors);
    const contentLabelLower = contentType === 'plugins' ? 'plugins' : 'mods';

    if (!mods.length && !loading) {
        return (
            <div css={tw`text-center py-16`}>
                <p css={tw`text-neutral-400 text-lg`}>No {contentLabelLower} found matching your search criteria.</p>
            </div>
        );
    }

    const totalPages = Math.ceil(pagination.totalCount / pagination.pageSize);
    const currentPage = Math.floor(pagination.index / pagination.pageSize) + 1;
    const isFirstPage = currentPage === 1;
    const isLastPage = currentPage >= totalPages;

    const pages = [];
    const start = Math.max(currentPage - 2, 1);
    const end = Math.min(totalPages, currentPage + 2);

    for (let i = start; i <= end; i++) {
        pages.push(i);
    }

    const handlePageClick = (pageNumber: number) => {
        const safePage = Math.min(Math.max(pageNumber, 1), totalPages);
        const newIndex = (safePage - 1) * pagination.pageSize;
        onPageChange(newIndex);
    };

    const movePage = (delta: number) => handlePageClick(currentPage + delta);

    return (
        <div css={tw`mt-6`}>
            <FadeTransition duration="duration-150" show={!loading}>
                <div css={tw`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3`}>
                    {mods.map(mod => {
                        const latestFile = mod.latestFiles?.[0];
                        const displayVersion =
                            latestFile?.gameVersions?.[0] ||
                            mod.latestFilesIndexes?.[0]?.gameVersion ||
                            gameVersion ||
                            undefined;
                        const downloadCount =
                            mod.downloadCount >= 1000000
                                ? `${(mod.downloadCount / 1000000).toFixed(1)}M`
                                : mod.downloadCount >= 1000
                                  ? `${(mod.downloadCount / 1000).toFixed(0)}K`
                                  : mod.downloadCount.toString();

                        return (
                            <ModCard key={mod.id} onClick={() => onModClick(mod)} $backgroundColor={background}>
                                <ModHeader>
                                    <ModIcon
                                        src={mod.logo?.thumbnailUrl || '/assets/images/placeholder-mod.png'}
                                        alt={mod.name}
                                        onError={e => {
                                            const target = e.currentTarget;
                                            // Prevent infinite loop by checking if already set to placeholder
                                            if (!target.dataset.fallbackAttempted) {
                                                target.dataset.fallbackAttempted = 'true';
                                                target.src = '/assets/images/placeholder-mod.png';
                                            }
                                        }}
                                    />
                                    <ModInfo>
                                        <ModName title={mod.name}>{mod.name}</ModName>
                                        <ModAuthor title={mod.authors[0]?.name || 'Unknown'}>
                                            by {mod.authors[0]?.name || 'Unknown'}
                                        </ModAuthor>
                                        <div css={tw`flex gap-2 mt-1`}>
                                            {mod.isPremium && (
                                                <span
                                                    css={tw`text-[11px] px-2 py-0.5 bg-red-900/60 text-red-200 rounded`}
                                                >
                                                    Premium
                                                </span>
                                            )}
                                            {mod.isExternal && (
                                                <span
                                                    css={tw`text-[11px] px-2 py-0.5 bg-yellow-900/60 text-yellow-200 rounded`}
                                                >
                                                    External
                                                </span>
                                            )}
                                        </div>
                                    </ModInfo>
                                </ModHeader>
                                <ModStats>
                                    {displayVersion && (
                                        <StatItem>
                                            <StatLabel>Version:</StatLabel>
                                            <StatValue>{displayVersion}</StatValue>
                                        </StatItem>
                                    )}
                                    <StatItem css={tw`ml-auto`}>
                                        <FontAwesomeIcon icon={faDownload} css={tw`text-neutral-500`} />
                                        <StatValue>{downloadCount}</StatValue>
                                    </StatItem>
                                </ModStats>
                            </ModCard>
                        );
                    })}
                </div>

                {loading && (
                    <div css={tw`mt-6 flex justify-center`}>
                        <Spinner />
                    </div>
                )}

                {totalPages > 1 && (
                    <div css={tw`my-6 flex justify-center`}>
                        <PaginationButton.Text
                            size={Button.Sizes.Small}
                            className={'mx-1'}
                            onClick={() => movePage(-10)}
                            disabled={isFirstPage}
                        >
                            <FontAwesomeIcon icon={faAngleDoubleLeft} />
                        </PaginationButton.Text>
                        <PaginationButton.Text
                            size={Button.Sizes.Small}
                            className={'mx-1'}
                            onClick={() => movePage(-1)}
                            disabled={isFirstPage}
                        >
                            <FontAwesomeIcon icon={faAngleLeft} />
                        </PaginationButton.Text>
                        {pages.map(i => (
                            <PaginationButton.Text
                                size={Button.Sizes.Small}
                                className={'mx-1'}
                                key={`page_${i}`}
                                onClick={() => handlePageClick(i)}
                                disabled={i === currentPage}
                            >
                                {i}
                            </PaginationButton.Text>
                        ))}
                        <PaginationButton.Text
                            size={Button.Sizes.Small}
                            className={'mx-1'}
                            onClick={() => movePage(1)}
                            disabled={isLastPage}
                        >
                            <FontAwesomeIcon icon={faAngleRight} />
                        </PaginationButton.Text>
                        <PaginationButton.Text
                            size={Button.Sizes.Small}
                            onClick={() => movePage(10)}
                            className={'mx-1'}
                            disabled={isLastPage}
                        >
                            <FontAwesomeIcon icon={faAngleDoubleRight} />
                        </PaginationButton.Text>
                    </div>
                )}

                {pagination.totalCount > 0 && (
                    <p css={tw`text-center text-sm text-neutral-400 mt-4`}>
                        Showing {pagination.index + 1} -{' '}
                        {Math.min(pagination.index + pagination.resultCount, pagination.totalCount)} of{' '}
                        {pagination.totalCount.toLocaleString()} {contentLabelLower}
                    </p>
                )}
            </FadeTransition>
        </div>
    );
};

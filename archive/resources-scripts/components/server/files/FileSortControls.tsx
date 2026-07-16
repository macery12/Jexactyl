import { memo } from 'react';
import tw from 'twin.macro';
import { ServerContext } from '@/state/server';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faSortAmountDown, faSortAmountUp, faSearch } from '@fortawesome/free-solid-svg-icons';
import type { SortField } from '@/state/server/files';
import { Button } from '@/elements/button/index';
import { useStoreState } from '@/state/hooks';
import Tooltip from '@/elements/tooltip/Tooltip';
import Input from '@/elements/Input';

const sortOptions: Array<{ value: SortField; label: string; tooltip: string }> = [
    { value: 'name', label: 'Name', tooltip: 'Sort by file/folder name' },
    { value: 'modified', label: 'Modified', tooltip: 'Sort by last modified date' },
    { value: 'size', label: 'Size', tooltip: 'Sort by file size' },
    { value: 'type', label: 'Type', tooltip: 'Sort by file type/extension' },
];

const FileSortControls = () => {
    const { colors } = useStoreState(state => state.theme.data!);
    const sortField = ServerContext.useStoreState(state => state.files.sortField);
    const sortDirection = ServerContext.useStoreState(state => state.files.sortDirection);
    const searchTerm = ServerContext.useStoreState(state => state.files.searchTerm);
    const setSortField = ServerContext.useStoreActions(actions => actions.files.setSortField);
    const setSortDirection = ServerContext.useStoreActions(actions => actions.files.setSortDirection);
    const setSearchTerm = ServerContext.useStoreActions(actions => actions.files.setSearchTerm);

    const handleSortFieldChange = (field: SortField) => {
        if (field === sortField) {
            // Toggle direction if clicking the same field
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            // Set new field with default ascending direction
            setSortField(field);
            setSortDirection('asc');
        }
    };

    return (
        <div css={tw`flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4`}>
            <div css={tw`flex flex-wrap items-center gap-2 sm:gap-3`}>
                <span css={tw`text-sm text-neutral-400 font-medium`}>Sort by:</span>
                <div css={tw`flex flex-wrap gap-2`}>
                    {sortOptions.map(option => (
                        <Tooltip key={option.value} content={option.tooltip} placement="top">
                            <Button
                                size={Button.Sizes.Small}
                                variant={
                                    sortField === option.value ? Button.Variants.Primary : Button.Variants.Secondary
                                }
                                onClick={() => handleSortFieldChange(option.value)}
                                css={tw`px-3 py-1.5 text-xs transition-all duration-150`}
                                style={
                                    sortField === option.value
                                        ? { backgroundColor: colors.primary }
                                        : { backgroundColor: colors.secondary }
                                }
                            >
                                {option.label}
                                {sortField === option.value && (
                                    <FontAwesomeIcon
                                        icon={sortDirection === 'asc' ? faSortAmountUp : faSortAmountDown}
                                        css={tw`ml-1.5`}
                                        size="xs"
                                    />
                                )}
                            </Button>
                        </Tooltip>
                    ))}
                </div>
            </div>
            <div css={tw`flex items-center gap-2 flex-1 sm:max-w-xs`}>
                <div css={tw`relative flex-1 flex items-center h-10`}>
                    <FontAwesomeIcon
                        icon={faSearch}
                        css={tw`absolute left-4 text-neutral-400 pointer-events-none`}
                        size="sm"
                    />
                    <Input
                        type="text"
                        placeholder="Search files..."
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        style={{ paddingLeft: '2.5rem', fontSize: '0.875rem' }}
                        aria-label="Search files by name"
                        role="searchbox"
                    />
                </div>
            </div>
        </div>
    );
};

export default memo(FileSortControls);

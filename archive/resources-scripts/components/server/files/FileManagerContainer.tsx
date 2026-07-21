import type { ChangeEvent } from 'react';
import { useEffect, useMemo, useState } from 'react';
import tw from 'twin.macro';

import { httpErrorToHuman } from '@/api/http';
import Spinner from '@/elements/Spinner';
import FileObjectGrid from '@server/files/FileObjectGrid';
import FileManagerBreadcrumbs from '@server/files/FileManagerBreadcrumbs';
import { type FileObject } from '@definitions/server';
import NewDirectoryButton from '@server/files/NewDirectoryButton';
import { NavLink, useLocation } from 'react-router-dom';
import Can from '@/elements/Can';
import { ServerError } from '@/elements/ScreenBlock';
import { Button } from '@/elements/button/index';
import { ServerContext } from '@/state/server';
import useFileManagerSwr from '@/plugins/useFileManagerSwr';
import FileManagerStatus from '@server/files/FileManagerStatus';
import MassActionsBar from '@server/files/MassActionsBar';
import UploadButton from '@server/files/UploadButton';
import { useStoreActions, useStoreState } from '@/state/hooks';
import ErrorBoundary from '@/elements/ErrorBoundary';
import { FileActionCheckbox } from '@server/files/SelectFileCheckbox';
import style from './style.module.css';
import FadeTransition from '@/elements/transitions/FadeTransition';
import { usePersistedState } from '@/plugins/usePersistedState';
import { faBorderAll, faList, faSearch, faTerminal, faNetworkWired } from '@fortawesome/free-solid-svg-icons';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import FileObjectList from './FileObjectList';
import CopyOnClick from '@/elements/CopyOnClick';
import Input from '@/elements/Input';
import Label from '@/elements/Label';
import TitledGreyBox from '@/elements/TitledGreyBox';
import { ip } from '@/lib/formatters';
import PageContentBlock from '@/elements/PageContentBlock';
import { hashToPath } from '@/lib/helpers';
import FileSortControls from '@server/files/FileSortControls';
import FileSearchDialog from '@server/files/FileSearchDialog';
import SshInfoPanel from '@server/files/SshInfoPanel';
import type { SortField, SortDirection } from '@/state/server/files';

const sortFiles = (files: FileObject[], sortField: SortField, sortDirection: SortDirection): FileObject[] => {
    const sorted = [...files].sort((a, b) => {
        if (a.isFile !== b.isFile) {
            return a.isFile ? 1 : -1;
        }

        let comparison = 0;

        switch (sortField) {
            case 'name':
                comparison = a.name.localeCompare(b.name);
                break;
            case 'modified':
                comparison = a.modifiedAt.getTime() - b.modifiedAt.getTime();
                break;
            case 'size':
                comparison = a.size - b.size;
                break;
            case 'type': {
                const extA = a.isFile ? a.name.split('.').pop()?.toLowerCase() || '' : '';
                const extB = b.isFile ? b.name.split('.').pop()?.toLowerCase() || '' : '';
                comparison = extA.localeCompare(extB);
                break;
            }
        }

        return sortDirection === 'asc' ? comparison : -comparison;
    });

    return sorted.filter((file, index) => index === 0 || file.name !== sorted[index - 1]?.name);
};

const filterFiles = (files: FileObject[], searchTerm: string): FileObject[] => {
    if (!searchTerm.trim()) return files;
    const lowerSearchTerm = searchTerm.toLowerCase();
    return files.filter(file => file.name.toLowerCase().includes(lowerSearchTerm));
};

// Formats bytes into a human-readable string
const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KiB', 'MiB', 'GiB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
};

export default () => {
    const id = ServerContext.useStoreState(state => state.server.data!.id);
    const isSupercharged = ServerContext.useStoreState(state => state.server.data!.isNodeSupercharged);
    const [showSearch, setShowSearch] = useState(false);
    const [showConnectionPanel, setShowConnectionPanel] = useState(false);
    const { hash } = useLocation();
    const { data: files, error, mutate } = useFileManagerSwr();
    const directory = ServerContext.useStoreState(state => state.files.directory);
    const clearFlashes = useStoreActions(actions => actions.flashes.clearFlashes);
    const setDirectory = ServerContext.useStoreActions(actions => actions.files.setDirectory);
    const [gridView, setGridView] = usePersistedState<boolean>(`${id}_file_manager_view`, false);
    const sortField = ServerContext.useStoreState(state => state.files.sortField);
    const sortDirection = ServerContext.useStoreState(state => state.files.sortDirection);
    const searchTerm = ServerContext.useStoreState(state => state.files.searchTerm);
    const setSortField = ServerContext.useStoreActions(actions => actions.files.setSortField);
    const setSortDirection = ServerContext.useStoreActions(actions => actions.files.setSortDirection);
    const { colors } = useStoreState(state => state.theme.data!);
    const [persistedSortField, setPersistedSortField] = usePersistedState<SortField>(
        `${id}_file_manager_sort_field`,
        'name',
    );
    const [persistedSortDirection, setPersistedSortDirection] = usePersistedState<SortDirection>(
        `${id}_file_manager_sort_direction`,
        'asc',
    );

    const sftp = ServerContext.useStoreState(state => state.server.data!.sftpDetails);
    const username = useStoreState(state => state.user.data!.username);
    const setSelectedFiles = ServerContext.useStoreActions(actions => actions.files.setSelectedFiles);
    const selectedFilesLength = ServerContext.useStoreState(state => state.files.selectedFiles.length);

    useEffect(() => {
        setSortField(persistedSortField);
        setSortDirection(persistedSortDirection);
    }, []);

    useEffect(() => {
        setPersistedSortField(sortField);
        setPersistedSortDirection(sortDirection);
    }, [sortField, sortDirection, setPersistedSortField, setPersistedSortDirection]);

    useEffect(() => {
        clearFlashes('files');
        setSelectedFiles([]);
        setDirectory(hashToPath(hash));
    }, [hash]);

    useEffect(() => {
        void mutate();
    }, [directory]);

    const onSelectAllClick = (e: ChangeEvent<HTMLInputElement>) => {
        setSelectedFiles(e.currentTarget.checked ? files?.map(file => file.name) || [] : []);
    };

    const { filteredFiles, displayFiles } = useMemo(() => {
        if (!files) return { filteredFiles: [], displayFiles: [] };
        const filtered = filterFiles(files, searchTerm);
        const sorted = sortFiles(filtered, sortField, sortDirection);
        const display = sorted.slice(0, 250);
        return { filteredFiles: filtered, displayFiles: display };
    }, [files, searchTerm, sortField, sortDirection]);

    // Total size of all displayed files (folders report 0 size, which is correct)
    const totalSize = useMemo(() => displayFiles.reduce((acc, f) => acc + (f.isFile ? f.size : 0), 0), [displayFiles]);

    if (error) {
        return <ServerError message={httpErrorToHuman(error)} onRetry={() => mutate()} />;
    }

    return (
        <PageContentBlock
            title={'File Manager'}
            header
            description={'Control your files and folders via the UI.'}
            showFlashKey={'files'}
        >
            <ErrorBoundary>
                {/* ── Toolbar row ── */}
                <div className={'mb-2 flex flex-wrap-reverse items-center gap-2 md:flex-nowrap'}>
                    <FileManagerBreadcrumbs
                        renderLeft={
                            <FileActionCheckbox
                                type={'checkbox'}
                                css={tw`mx-4`}
                                checked={selectedFilesLength === (files?.length === 0 ? -1 : files?.length)}
                                onChange={onSelectAllClick}
                            />
                        }
                    />
                    <Can action={'file.create'}>
                        <div className={style.manager_actions}>
                            <FileManagerStatus />
                            <NewDirectoryButton />
                            <UploadButton />
                            <NavLink to={`/server/${id}/files/new${window.location.hash}`}>
                                <Button>New File</Button>
                            </NavLink>
                            <Button onClick={() => setGridView(!gridView)} title={gridView ? 'List view' : 'Grid view'}>
                                <FontAwesomeIcon icon={gridView ? faList : faBorderAll} fixedWidth />
                            </Button>
                            {/* Connection details toggle — keeps sidebar off-screen by default */}
                            <Can action={'file.sftp'}>
                                <Button
                                    onClick={() => setShowConnectionPanel(v => !v)}
                                    title={'Connection Details'}
                                    css={showConnectionPanel ? tw`opacity-100` : tw`opacity-60 hover:opacity-100`}
                                >
                                    <FontAwesomeIcon icon={faNetworkWired} fixedWidth />
                                </Button>
                            </Can>
                            {isSupercharged && (
                                <Button onClick={() => setShowSearch(true)} title={'Advanced Search'}>
                                    <FontAwesomeIcon icon={faSearch} fixedWidth />
                                </Button>
                            )}
                        </div>
                    </Can>
                </div>

                {/* ── Sort + search controls ── */}
                <div className={'mb-4'}>
                    <FileSortControls />
                </div>
            </ErrorBoundary>

            {isSupercharged && <FileSearchDialog open={showSearch} onClose={() => setShowSearch(false)} />}

            {/* ── 250-file warning — slim banner ── */}
            {filteredFiles.length > 250 && (
                <div css={tw`mb-3 rounded px-3 py-2 bg-yellow-400`}>
                    <p css={tw`text-yellow-900 text-xs text-center`}>
                        {searchTerm
                            ? `Found ${filteredFiles.length} matches — showing first 250.`
                            : 'Directory too large to display fully — showing first 250 files.'}
                    </p>
                </div>
            )}

            {/* ── Search result count — slim banner ── */}
            {searchTerm && filteredFiles.length > 0 && filteredFiles.length <= 250 && (
                <div css={tw`mb-3 rounded px-3 py-2`} style={{ backgroundColor: colors.primary }}>
                    <p css={tw`text-white text-xs text-center`}>
                        {filteredFiles.length} {filteredFiles.length === 1 ? 'file' : 'files'} matching &quot;
                        {searchTerm}&quot;
                    </p>
                </div>
            )}

            {/* ── Main content + optional connection panel ── */}
            <div
                className={`grid gap-4 ${showConnectionPanel ? 'xl:grid-cols-[minmax(0,1fr)_minmax(26rem,32rem)]' : ''}`}
            >
                {/* File browser — always primary */}
                <div className={'min-w-0'}>
                    {!files ? (
                        <Spinner size={'large'} centered />
                    ) : (
                        <>
                            {!filteredFiles.length ? (
                                <p css={tw`text-sm text-neutral-400 text-center`}>
                                    {searchTerm
                                        ? 'No files found matching your search.'
                                        : 'This directory seems to be empty.'}
                                </p>
                            ) : (
                                <FadeTransition duration="duration-150" appear show>
                                    <div>
                                        {gridView ? (
                                            <div className={'grid grid-cols-2 gap-2 lg:grid-cols-6 lg:gap-4'}>
                                                {displayFiles.map(file => (
                                                    <FileObjectGrid key={file.key} file={file} />
                                                ))}
                                            </div>
                                        ) : (
                                            <>
                                                {displayFiles.map(file => (
                                                    <FileObjectList key={file.key} file={file} />
                                                ))}
                                            </>
                                        )}
                                        <MassActionsBar />
                                    </div>
                                </FadeTransition>
                            )}
                        </>
                    )}

                    {/* ── Status bar ── */}
                    {files && filteredFiles.length > 0 && (
                        <div css={tw`mt-3 flex items-center justify-between text-xs text-neutral-500 px-1`}>
                            <span>
                                {searchTerm
                                    ? `${filteredFiles.length} result${filteredFiles.length !== 1 ? 's' : ''}`
                                    : `${displayFiles.length} item${displayFiles.length !== 1 ? 's' : ''}`}
                                {totalSize > 0 && ` · ${formatBytes(totalSize)}`}
                            </span>
                            {filteredFiles.length > 250 && <span css={tw`text-yellow-500`}>Showing first 250</span>}
                        </div>
                    )}
                </div>

                {/* ── Connection details panel — only rendered when toggled ── */}
                {showConnectionPanel && (
                    <Can action={'file.sftp'}>
                        <div className={'xl:self-start xl:sticky xl:top-6'}>
                            <TitledGreyBox title={'Connection Details'} icon={faNetworkWired} className={'h-auto'}>
                                <div>
                                    <Label>SFTP Server Address</Label>
                                    <CopyOnClick text={`sftp://${ip(sftp.ip)}:${sftp.port}`}>
                                        <Input type={'text'} value={`sftp://${ip(sftp.ip)}:${sftp.port}`} readOnly />
                                    </CopyOnClick>
                                </div>
                                <div css={tw`mt-6`}>
                                    <Label>SFTP Username</Label>
                                    <CopyOnClick text={`${username}.${id}`}>
                                        <Input type={'text'} value={`${username}.${id}`} readOnly />
                                    </CopyOnClick>
                                </div>
                                <div css={tw`mt-6 flex items-center`}>
                                    <div css={tw`flex-1`}>
                                        <div css={tw`border-l-4 border-cyan-500 p-3`}>
                                            <p css={tw`text-xs text-neutral-200`}>
                                                Your SFTP password is the same as the password you use to access this
                                                panel.
                                            </p>
                                        </div>
                                    </div>
                                    <div css={tw`ml-4`}>
                                        <a href={`sftp://${username}.${id}@${ip(sftp.ip)}:${sftp.port}`}>
                                            <Button.Text variant={Button.Variants.Secondary}>Launch SFTP</Button.Text>
                                        </a>
                                    </div>
                                </div>
                                {isSupercharged && <SshInfoPanel />}
                            </TitledGreyBox>
                        </div>
                    </Can>
                )}
            </div>
        </PageContentBlock>
    );
};

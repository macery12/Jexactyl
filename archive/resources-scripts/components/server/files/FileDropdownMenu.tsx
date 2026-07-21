import { memo, useEffect, useRef, useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faEllipsisH } from '@fortawesome/free-solid-svg-icons';
import RenameFileModal from '@server/files/RenameFileModal';
import { ServerContext } from '@/state/server';
import { join } from 'pathe';
import { useNavigate } from 'react-router-dom';
import { deleteFiles, copyFile, getFileDownloadUrl, compressFiles, decompressFiles } from '@/api/routes/server/files';
import Can from '@/elements/Can';
import { type FileObject } from '@definitions/server';
import useFlash from '@/plugins/useFlash';
import tw from 'twin.macro';
import useFileManagerSwr from '@/plugins/useFileManagerSwr';
import DropdownMenu from '@/elements/DropdownMenu';
import useEventListener from '@/plugins/useEventListener';
import isEqual from 'react-fast-compare';
import ChmodFileModal from '@server/files/ChmodFileModal';
import CompressFormatDialog from '@server/files/CompressFormatDialog';
import FileFingerprintDialog from '@server/files/FileFingerprintDialog';
import { encodePathSegments } from '@/lib/helpers';
import { Dialog } from '@/elements/dialog';
import { Button } from '@/elements/button';
import {
    ArchiveIcon,
    ArrowUpIcon,
    ClipboardCopyIcon,
    CogIcon,
    DownloadIcon,
    FingerPrintIcon,
    InboxIcon,
    LightningBoltIcon,
    PencilIcon,
    TrashIcon,
} from '@heroicons/react/outline';

type ModalType = 'rename' | 'move' | 'chmod';

const FileDropdownMenu = ({ file }: { file: FileObject }) => {
    const onClickRef = useRef<DropdownMenu>(null);
    const [visible, setVisible] = useState<boolean>(false);
    const [modal, setModal] = useState<ModalType | null>(null);
    const [showConfirmation, setShowConfirmation] = useState(false);
    const [showAdvancedCompress, setShowAdvancedCompress] = useState(false);
    const [showFingerprints, setShowFingerprints] = useState(false);

    const uuid = ServerContext.useStoreState(state => state.server.data!.uuid);
    const id = ServerContext.useStoreState(state => state.server.data!.id);
    const isSupercharged = ServerContext.useStoreState(state => state.server.data!.isNodeSupercharged);
    const { mutate } = useFileManagerSwr();
    const { clearAndAddHttpError, clearFlashes } = useFlash();
    const directory = ServerContext.useStoreState(state => state.files.directory);
    const navigate = useNavigate();

    const getArchiveExtractedDirectory = (archiveName: string): string => {
        const lower = archiveName.toLowerCase();

        const multiExtensions = ['.tar.gz', '.tar.xz', '.tar.bz2', '.tar.lz4', '.tar.zstd', '.tar.lzip'];
        for (const extension of multiExtensions) {
            if (lower.endsWith(extension)) {
                return archiveName.slice(0, archiveName.length - extension.length);
            }
        }

        const singleExtensions = ['.zip', '.7z', '.tar'];
        for (const extension of singleExtensions) {
            if (lower.endsWith(extension)) {
                return archiveName.slice(0, archiveName.length - extension.length);
            }
        }

        return archiveName;
    };

    useEventListener(`pterodactyl:files:ctx:${file.key}`, (e: CustomEvent) => {
        if (onClickRef.current) {
            onClickRef.current.triggerMenu(e.detail);
        }
    });

    useEffect(() => {
        if (modal || showConfirmation) {
            setVisible(false);
        }
    }, [modal, showConfirmation]);

    const doDeletion = async () => {
        clearFlashes('files');

        // For UI speed, immediately remove the file from the listing before calling the deletion function.
        // If the delete actually fails, we'll fetch the current directory contents again automatically.
        await mutate(files => files!.filter(f => f.key !== file.key), false);

        deleteFiles(uuid, directory, [file.name]).catch(error => {
            mutate();
            clearAndAddHttpError({ key: 'files', error });
        });
    };

    const doCopy = () => {
        clearFlashes('files');

        copyFile(uuid, join(directory, file.name))
            .then(() => {
                mutate();
                setVisible(false);
            })
            .catch(error => clearAndAddHttpError({ key: 'files', error }));
    };

    const doDownload = () => {
        clearFlashes('files');

        getFileDownloadUrl(uuid, join(directory, file.name))
            .then(url => {
                // @ts-expect-error this is valid
                window.location = url;
            })
            .catch(error => clearAndAddHttpError({ key: 'files', error }));
    };

    const doArchive = () => {
        clearFlashes('files');

        compressFiles(uuid, directory, [file.name])
            .then(() => {
                mutate();
                setVisible(false);
            })
            .catch(error => clearAndAddHttpError({ key: 'files', error }));
    };

    const doUnarchive = () => {
        clearFlashes('files');

        decompressFiles(uuid, directory, file.name)
            .then(() => {
                mutate();
                setVisible(false);
            })
            .catch(error => clearAndAddHttpError({ key: 'files', error }));
    };

    const doExploreArchive = () => {
        clearFlashes('files');

        decompressFiles(uuid, directory, file.name)
            .then(() => {
                mutate();
                setVisible(false);

                const extractedDirectory = getArchiveExtractedDirectory(file.name);
                const path = encodePathSegments(join(directory, extractedDirectory));

                navigate(`/server/${id}/files#${path}`);
            })
            .catch(error => clearAndAddHttpError({ key: 'files', error }));
    };

    return (
        <>
            {modal ? (
                modal === 'chmod' ? (
                    <ChmodFileModal
                        visible
                        appear
                        files={[{ file: file.name, mode: file.modeBits }]}
                        onDismissed={() => setModal(null)}
                    />
                ) : (
                    <RenameFileModal
                        visible
                        appear
                        files={[file.name]}
                        useMoveTerminology={modal === 'move'}
                        onDismissed={() => setModal(null)}
                    />
                )
            ) : null}
            <CompressFormatDialog
                open={showAdvancedCompress}
                onClose={() => setShowAdvancedCompress(false)}
                files={[file.name]}
                directory={directory}
            />
            <FileFingerprintDialog
                open={showFingerprints}
                onClose={() => setShowFingerprints(false)}
                files={[join(directory, file.name)]}
                directory={directory}
            />
            <Dialog.Confirm
                open={showConfirmation}
                onClose={() => setShowConfirmation(false)}
                title={`Delete ${file.isFile ? 'File' : 'Directory'}`}
                confirm={'Delete'}
                onConfirmed={doDeletion}
            >
                You will not be able to recover the contents of&nbsp;
                <span className={'font-semibold text-slate-50'}>{file.name}</span> once deleted.
            </Dialog.Confirm>
            <div
                css={tw`absolute top-0 right-0 p-2 hover:text-white text-gray-400 duration-250`}
                onClick={() => setVisible(true)}
            >
                <FontAwesomeIcon icon={faEllipsisH} className={'rounded bg-black/25 p-1'} />
            </div>
            {visible && (
                <Dialog open={visible} onClose={() => setVisible(false)} title={'File Options'}>
                    <div className={'mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 lg:gap-4'}>
                        <Can action={'file.update'}>
                            <Button.Text onClick={() => setModal('rename')} className={'w-full'}>
                                <PencilIcon className={'mt-0.5 mr-2 w-4'} />
                                Rename
                            </Button.Text>
                            <Button.Text onClick={() => setModal('move')} className={'w-full'}>
                                <ArrowUpIcon className={'mt-0.5 mr-2 w-4'} />
                                Move
                            </Button.Text>
                            <Button.Text onClick={() => setModal('chmod')} className={'w-full'}>
                                <CogIcon className={'mt-0.5 mr-2 w-4'} />
                                Permissions
                            </Button.Text>
                        </Can>
                        {file.isFile && (
                            <Can action={'file.create'}>
                                <Button.Text onClick={doCopy}>
                                    <ClipboardCopyIcon className={'mt-0.5 mr-2 w-4'} />
                                    Copy File
                                </Button.Text>
                            </Can>
                        )}
                        {file.isArchiveType() ? (
                            <Can action={'file.create'}>
                                <Button.Text onClick={doUnarchive}>
                                    <InboxIcon className={'mt-0.5 mr-2 w-4'} />
                                    Extract Files
                                </Button.Text>
                                <Button.Text onClick={doExploreArchive}>
                                    <InboxIcon className={'mt-0.5 mr-2 w-4'} />
                                    Explore Archive
                                </Button.Text>
                            </Can>
                        ) : (
                            <Can action={'file.archive'}>
                                <Button.Text onClick={doArchive}>
                                    <ArchiveIcon className={'mt-0.5 mr-2 w-4'} />
                                    Archive File
                                </Button.Text>
                            </Can>
                        )}
                        {isSupercharged && !file.isArchiveType() && (
                            <Can action={'file.archive'}>
                                <Button.Text
                                    onClick={() => {
                                        setVisible(false);
                                        setShowAdvancedCompress(true);
                                    }}
                                >
                                    <LightningBoltIcon className={'mt-0.5 mr-2 w-4'} />
                                    Advanced Compress
                                </Button.Text>
                            </Can>
                        )}
                        {isSupercharged && file.isFile && (
                            <Can action={'file.read'}>
                                <Button.Text
                                    onClick={() => {
                                        setVisible(false);
                                        setShowFingerprints(true);
                                    }}
                                >
                                    <FingerPrintIcon className={'mt-0.5 mr-2 w-4'} />
                                    Checksum
                                </Button.Text>
                            </Can>
                        )}
                        {file.isFile && (
                            <Button.Text onClick={doDownload}>
                                <DownloadIcon className={'mt-0.5 mr-2 w-4'} />
                                Download
                            </Button.Text>
                        )}
                        <Can action={'file.archive'}>
                            <Button.Danger onClick={() => setShowConfirmation(true)}>
                                <TrashIcon className={'mt-0.5 mr-2 w-4'} />
                                Delete
                            </Button.Danger>
                        </Can>
                    </div>
                </Dialog>
            )}
        </>
    );
};

export default memo(FileDropdownMenu, isEqual);

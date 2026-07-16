import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faFileAlt, faFileArchive, faFileImport, faFolder } from '@fortawesome/free-solid-svg-icons';
import { differenceInHours, format, formatDistanceToNow } from 'date-fns';
import { memo, ReactNode } from 'react';
import FileDropdownMenu from '@server/files/FileDropdownMenu';
import { ServerContext } from '@/state/server';
import { NavLink } from 'react-router-dom';
import tw from 'twin.macro';
import isEqual from 'react-fast-compare';
import SelectFileCheckbox from '@server/files/SelectFileCheckbox';
import { usePermissions } from '@/plugins/usePermissions';
import { join } from 'pathe';
import { bytesToString } from '@/lib/formatters';
import styles from './style.module.css';
import { FileObject } from '@definitions/server';
import { useStoreState } from '@/state/hooks';
import classNames from 'classnames';
import { encodePathSegments } from '@/lib/helpers';

const isVirtualArchiveType = (name: string) => {
    const lower = name.toLowerCase();

    return lower.endsWith('.zip') || lower.endsWith('.7z') || lower.endsWith('.ddup');
};

function Clickable({ file, children }: { file: FileObject; children: ReactNode }) {
    const [canRead] = usePermissions(['file.read']);
    const [canReadContents] = usePermissions(['file.read-content']);
    const id = ServerContext.useStoreState(state => state.server.data!.id);
    const directory = ServerContext.useStoreState(state => state.files.directory);

    const isArchive = file.isFile && file.isArchiveType();
    const isVirtualArchive = isArchive && isVirtualArchiveType(file.name);
    const canBrowseAsFolder = !file.isFile || isVirtualArchive;
    const canOpenInEditor = file.isFile && !isArchive;

    const canAccess = canBrowseAsFolder ? canRead : canOpenInEditor ? canReadContents : false;
    if (!canAccess) {
        return <div className={styles.details}>{children}</div>;
    }

    const nextPath = encodePathSegments(join(directory, file.name));
    const target = canBrowseAsFolder ? `/server/${id}/files#${nextPath}` : `/server/${id}/files/edit${nextPath}`;

    return (
        <NavLink className={styles.details} to={target}>
            {children}
        </NavLink>
    );
}
const FileObjectRow = ({ file }: { file: FileObject }) => {
    const { colors } = useStoreState(state => state.theme.data!);

    return (
        <div
            className={classNames(styles.file_row, 'hover:brightness-125')}
            style={{ backgroundColor: colors.secondary }}
            key={file.name}
            onContextMenu={e => {
                e.preventDefault();
                window.dispatchEvent(new CustomEvent(`pterodactyl:files:ctx:${file.key}`, { detail: e.clientX }));
            }}
        >
            <SelectFileCheckbox name={file.name} />
            <Clickable file={file}>
                <div css={tw`flex-none text-neutral-400 ml-6 mr-4 text-lg pl-3`}>
                    {file.isFile ? (
                        <FontAwesomeIcon
                            icon={file.isSymlink ? faFileImport : file.isArchiveType() ? faFileArchive : faFileAlt}
                        />
                    ) : (
                        <FontAwesomeIcon icon={faFolder} />
                    )}
                </div>
                <div css={tw`flex-1 truncate`}>{file.name}</div>
                {file.isFile && <div css={tw`w-1/6 text-right mr-4 hidden sm:block`}>{bytesToString(file.size)}</div>}
                <div css={tw`w-1/5 text-right mr-6 hidden md:block text-white/50`} title={file.modifiedAt.toString()}>
                    {Math.abs(differenceInHours(file.modifiedAt, new Date())) > 48
                        ? format(file.modifiedAt, 'MMM do, yyyy h:mma')
                        : formatDistanceToNow(file.modifiedAt, { addSuffix: true })}
                </div>
            </Clickable>
            <FileDropdownMenu file={file} />
        </div>
    );
};
export default memo(FileObjectRow, (prevProps, nextProps) => {
    /* eslint-disable @typescript-eslint/no-unused-vars */
    const { isArchiveType, isEditable, ...prevFile } = prevProps.file;
    const { isArchiveType: nextIsArchiveType, isEditable: nextIsEditable, ...nextFile } = nextProps.file;
    /* eslint-enable @typescript-eslint/no-unused-vars */

    return isEqual(prevFile, nextFile);
});

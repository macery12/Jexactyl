import { useEffect, useMemo, useState } from 'react';
import { isAxiosError } from 'axios';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import {
    ArrowDownUp,
    ChevronRight,
    Copy,
    Download,
    DownloadCloud,
    File as FileIcon,
    FileArchive,
    Info,
    Folder,
    FolderInput,
    FolderPlus,
    FilePlus,
    Fingerprint,
    FolderOpen,
    LayoutGrid,
    List as ListIcon,
    MoreVertical,
    Network,
    Package,
    PackageOpen,
    Pencil,
    Search,
    Settings2,
    Trash2,
    ArrowUp,
    ArrowDown,
} from 'lucide-react';
import { m } from '@/i18n';
import { useServer } from '@/components/server/ServerContext';
import { can } from '@/lib/can';
import { formatBytes, timeAgo } from '@/lib/format';
import { firstError } from '@/lib/apiError';
import { useFlashes } from '@/state/flashes';
import { usePersistedState } from '@/hooks/usePersistedState';
import { useWideContent } from '@/components/shell/shellLayout';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
    loadDirectory,
    copyFile,
    compressFiles,
    decompressFile,
    deleteFiles,
    archiveContentsDirectory,
    archivePathSegment,
    getFileDownloadUrl,
    getDirectoryDownloadUrl,
    isArchive,
    isEditable,
    isVirtualArchive,
    type FileObject,
} from '@/api/files';
import {
    breadcrumbSegments,
    cleanDirectoryPath,
    encodePathSegments,
    hashToPath,
    join,
} from '../paths';
import { NewDirectoryModal, RenameMoveModal } from './Modals';
import { UploadButton } from './UploadButton';
import { ConnectionPanel } from './ConnectionPanel';
import { FileSearchModal } from './FileSearchModal';
import { CompressModal } from './CompressModal';
import { ChmodModal } from './ChmodModal';
import { ChecksumModal } from './ChecksumModal';
import { ArchiveActionModal } from './ArchiveActionModal';
import { PullModal } from './PullModal';

type SortField = 'name' | 'size' | 'modified' | 'type';
type SortDirection = 'asc' | 'desc';
const DISPLAY_CAP = 250;

// Extension used only for the "type" sort — groups like-typed files together.
function fileExtension(name: string): string {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

function sortFiles(files: FileObject[], field: SortField, dir: SortDirection): FileObject[] {
    const sorted = [...files].sort((a, b) => {
        if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
        let cmp: number;
        if (field === 'name') cmp = a.name.localeCompare(b.name);
        else if (field === 'modified') cmp = a.modifiedAt.getTime() - b.modifiedAt.getTime();
        else if (field === 'type') cmp = fileExtension(a.name).localeCompare(fileExtension(b.name)) || a.name.localeCompare(b.name);
        else cmp = a.size - b.size;
        return dir === 'asc' ? cmp : -cmp;
    });
    // Drop adjacent duplicates by name (V1 parity — daemon can double-report).
    return sorted.filter((f, i) => i === 0 || f.name !== sorted[i - 1]?.name);
}

// Archive jobs can outrun the request timeout on large directories; the daemon
// keeps going regardless, so surface that as info rather than a failure.
function isTimeout(e: unknown): boolean {
    return isAxiosError(e) && (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT');
}

// `openable` = a Supercharged node can browse into this archive; it gets the
// brand colour to read as interactive, while download-only archives stay amber.
function FileTypeIcon({ file, openable }: { file: FileObject; openable?: boolean }) {
    if (!file.isFile) return <Folder className="h-[18px] w-[18px] shrink-0 text-[var(--brand)]" />;
    if (isArchive(file)) {
        return (
            <FileArchive
                className={`h-[18px] w-[18px] shrink-0 ${openable ? 'text-[var(--brand)]' : 'text-[var(--color-warning)]'}`}
            />
        );
    }
    return <FileIcon className="h-[18px] w-[18px] shrink-0 text-[var(--color-ink-faint)]" />;
}

export default function FileBrowser() {
    useWideContent();
    const server = useServer();
    const { uuid, id, permissions: held } = server;
    const navigate = useNavigate();
    const qc = useQueryClient();
    const push = useFlashes(s => s.push);
    const { hash } = useLocation();
    const directory = cleanDirectoryPath(hashToPath(hash));

    const canCreate = can(held, 'file.create');
    const canUpdate = can(held, 'file.update');
    const canDelete = can(held, 'file.delete');
    const canSftp = can(held, 'file.sftp');
    const canArchive = can(held, 'file.archive');
    // Viewing/downloading file (and directory) contents is a distinct permission
    // from listing the directory (file.read) — mirrors V1's read vs read-content.
    const canReadContent = can(held, 'file.read-content');

    const [gridView, setGridView] = usePersistedState<boolean>(`${id}_file_manager_view`, false);
    const [sortField, setSortField] = usePersistedState<SortField>(`${id}_file_sort_field`, 'name');
    const [sortDirection, setSortDirection] = usePersistedState<SortDirection>(`${id}_file_sort_dir`, 'asc');
    const [searchTerm, setSearchTerm] = useState('');
    const [selected, setSelected] = useState<string[]>([]);
    const [showNewDir, setShowNewDir] = useState(false);
    const [showConnection, setShowConnection] = useState(false);
    const [showSearch, setShowSearch] = useState(false);
    const [rename, setRename] = useState<{ files: string[]; mode: 'rename' | 'move' } | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
    const [compressFormat, setCompressFormat] = useState<string[] | null>(null);
    const [chmod, setChmod] = useState<{ files: string[]; mode: string } | null>(null);
    const [checksum, setChecksum] = useState<string[] | null>(null);
    const [archiveAction, setArchiveAction] = useState<FileObject | null>(null);
    const [showPull, setShowPull] = useState(false);
    const [busy, setBusy] = useState<string | null>(null);
    const supercharged = server.isNodeSupercharged;
    // Non-null while browsing inside a zip/7z/ddup — everything here is read-only.
    const insideArchive = archivePathSegment(directory);

    const { data: files, isLoading, isError, refetch } = useQuery({
        queryKey: ['server-files', uuid, directory],
        queryFn: () => loadDirectory(uuid, directory),
    });

    // Reset transient state whenever the directory changes.
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional effect: syncs state to prop/query/filter changes
        setSelected([]);
        setSearchTerm('');
    }, [directory]);

    const { filtered, display } = useMemo(() => {
        if (!files) return { filtered: [] as FileObject[], display: [] as FileObject[] };
        const term = searchTerm.trim().toLowerCase();
        const f = term ? files.filter(x => x.name.toLowerCase().includes(term)) : files;
        return { filtered: f, display: sortFiles(f, sortField, sortDirection).slice(0, DISPLAY_CAP) };
    }, [files, searchTerm, sortField, sortDirection]);

    const totalSize = useMemo(() => display.reduce((acc, f) => acc + (f.isFile ? f.size : 0), 0), [display]);

    const toggleSort = (field: SortField) => {
        if (sortField === field) setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        else {
            setSortField(field);
            setSortDirection('asc');
        }
    };

    const openArchiveInline = (file: FileObject) =>
        navigate({ hash: encodePathSegments(join(directory, file.name)) });

    const openEntry = (file: FileObject) => {
        if (!file.isFile) {
            // Plain folders open directly.
            navigate({ hash: encodePathSegments(join(directory, file.name)) });
        } else if (isArchive(file)) {
            // Archives no longer download on a single click — the chooser makes it
            // clear which ones can be browsed here (zip/7z/ddup on wings-rs) versus
            // download-only formats (.tar.gz, .rar, …), and offers Extract. Only
            // open it when at least one action is actually available to the user.
            const openable = supercharged && isVirtualArchive(file);
            if (openable || canCreate || canReadContent) setArchiveAction(file);
        } else if (isEditable(file) && canReadContent) {
            navigate(`/server/${id}/files/edit/${encodePathSegments(join(directory, file.name))}`);
        } else if (canReadContent) {
            void download(file.name);
        }
    };

    const download = async (name: string) => {
        try {
            const url = await getFileDownloadUrl(uuid, join(directory, name));
            window.open(url);
        } catch (e) {
            push({ type: 'error', message: firstError(e) ?? m['common.states.genericError']() });
        }
    };

    const downloadDir = async (name: string) => {
        try {
            const url = await getDirectoryDownloadUrl(uuid, join(directory, name));
            window.open(url);
        } catch (e) {
            push({ type: 'error', message: firstError(e) ?? m['common.states.genericError']() });
        }
    };

    const copyMutation = useMutation({
        mutationFn: (name: string) => copyFile(uuid, join(directory, name)),
        onSuccess: async () => {
            push({ type: 'success', message: m['server.files.copied']() });
            await qc.invalidateQueries({ queryKey: ['server-files', uuid, directory] });
        },
        onError: (e: unknown) => push({ type: 'error', message: firstError(e) ?? m['common.states.genericError']() }),
    });

    // Compress + extract both hit the shared daemon endpoints, so one action
    // covers the Go daemon and wings-rs alike. Format selection (wings-rs only)
    // lives in CompressModal.
    const compressMutation = useMutation({
        mutationFn: (names: string[]) => compressFiles(uuid, directory, names),
        onMutate: () => setBusy(m['server.files.compressing']()),
        onSuccess: async () => {
            push({ type: 'success', message: m['server.files.compressed']() });
            setSelected([]);
            await qc.invalidateQueries({ queryKey: ['server-files', uuid, directory] });
        },
        onError: (e: unknown) =>
            push(
                isTimeout(e)
                    ? { type: 'info', message: m['server.files.compressSlow']() }
                    : { type: 'error', message: firstError(e) ?? m['common.states.genericError']() },
            ),
        onSettled: () => setBusy(null),
    });

    const extractMutation = useMutation({
        mutationFn: ({ name }: { name: string; open: boolean }) => decompressFile(uuid, directory, name),
        onMutate: () => setBusy(m['server.files.extracting']()),
        onSuccess: async (_r, { name, open }) => {
            push({ type: 'success', message: m['server.files.extracted']() });
            await qc.invalidateQueries({ queryKey: ['server-files', uuid, directory] });
            // Archives without a single top-level folder extract straight into the
            // current directory, so only navigate when that folder really appeared.
            if (open) {
                const target = archiveContentsDirectory(name);
                const fresh = await qc.fetchQuery({
                    queryKey: ['server-files', uuid, directory],
                    queryFn: () => loadDirectory(uuid, directory),
                });
                if (fresh.some(f => !f.isFile && f.name === target)) {
                    navigate({ hash: encodePathSegments(join(directory, target)) });
                }
            }
        },
        onError: (e: unknown) =>
            push(
                isTimeout(e)
                    ? { type: 'info', message: m['server.files.extractSlow']() }
                    : { type: 'error', message: firstError(e) ?? m['common.states.genericError']() },
            ),
        onSettled: () => setBusy(null),
    });

    const deleteMutation = useMutation({
        mutationFn: (names: string[]) => deleteFiles(uuid, directory, names),
        onSuccess: async (_r, names) => {
            push({ type: 'success', message: m['server.files.deleted']({ count: names.length }) });
            setSelected([]);
            setConfirmDelete(null);
            await qc.invalidateQueries({ queryKey: ['server-files', uuid, directory] });
        },
        onError: (e: unknown) => {
            push({ type: 'error', message: firstError(e) ?? m['common.states.genericError']() });
            setConfirmDelete(null);
        },
    });

    const toggleSelect = (name: string) =>
        setSelected(prev => (prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]));
    const allSelected = filtered.length > 0 && selected.length === filtered.length;
    const toggleSelectAll = () => setSelected(allSelected ? [] : filtered.map(f => f.name));

    // Per-file action handlers, shared by the list-row and grid-card menus so the
    // two views expose exactly the same options.
    const caps: FileCaps = { canUpdate, canCreate, canDelete, canArchive, canReadContent, supercharged };
    const actions: FileActions = {
        edit: f => navigate(`/server/${id}/files/edit/${encodePathSegments(join(directory, f.name))}`),
        rename: f => setRename({ files: [f.name], mode: 'rename' }),
        move: f => setRename({ files: [f.name], mode: 'move' }),
        copy: f => copyMutation.mutate(f.name),
        compress: f => compressMutation.mutate([f.name]),
        compressAs: f => setCompressFormat([f.name]),
        extract: (f, open) => extractMutation.mutate({ name: f.name, open }),
        chmod: f => setChmod({ files: [f.name], mode: f.modeBits }),
        checksum: f => setChecksum([f.name]),
        download: f => download(f.name),
        downloadDir: f => downloadDir(f.name),
        remove: f => setConfirmDelete([f.name]),
    };

    const crumbs = breadcrumbSegments(directory);

    return (
        <div className="w-full">
            {/* ── Header ── */}
            <div className="mb-5">
                <h1 className="text-xl font-semibold text-[var(--color-ink)]">{m['server.files.title']()}</h1>
                <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">{m['server.files.subtitle']()}</p>
            </div>

            {/* ── Toolbar ── */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
                <Breadcrumbs serverId={id} crumbs={crumbs} />
                <div className="ml-auto flex flex-wrap items-center gap-2">
                    <div className="relative">
                        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-ink-faint)]" />
                        <Input
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            placeholder={m['server.files.searchPlaceholder']()}
                            className="h-9 w-44 pl-9 text-sm"
                        />
                    </div>
                    {canCreate && (
                        <>
                            <Button variant="secondary" size="sm" onClick={() => setShowNewDir(true)}>
                                <FolderPlus className="h-4 w-4" />
                                {m['server.files.newDirectory']()}
                            </Button>
                            <UploadButton uuid={uuid} directory={directory} />
                            <Button variant="secondary" size="sm" onClick={() => setShowPull(true)}>
                                <DownloadCloud className="h-4 w-4" />
                                {m['server.files.pull.action']()}
                            </Button>
                            <Button
                                size="sm"
                                onClick={() => navigate(`/server/${id}/files/new${window.location.hash}`)}
                            >
                                <FilePlus className="h-4 w-4" />
                                {m['server.files.newFile']()}
                            </Button>
                        </>
                    )}
                    <SortMenu field={sortField} dir={sortDirection} onSelect={toggleSort} />
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9"
                        title={gridView ? m['server.files.listView']() : m['server.files.gridView']()}
                        onClick={() => setGridView(!gridView)}
                    >
                        {gridView ? <ListIcon className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
                    </Button>
                    {/* Labelled, not a bare icon — the connection drawer (and the
                        Launch SFTP action inside it) was undiscoverable otherwise. */}
                    {canSftp && (
                        <Button
                            variant="secondary"
                            size="sm"
                            title={m['server.files.connection.title']()}
                            onClick={() => setShowConnection(v => !v)}
                        >
                            <Network className="h-4 w-4" />
                            {m['server.files.connection.short']()}
                        </Button>
                    )}
                    {server.isNodeSupercharged && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9"
                            title={m['server.files.search.title']()}
                            onClick={() => setShowSearch(true)}
                        >
                            <Search className="h-4 w-4" />
                        </Button>
                    )}
                </div>
            </div>

            {/* ── Inside-archive notice ── the daemon lets you read into a zip,
                but the server can't use anything until it's extracted. ── */}
            {insideArchive && (
                <div className="mb-3 flex items-start gap-2.5 rounded-[var(--radius-card)] border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3.5 py-2.5 text-sm text-[var(--color-warning)]">
                    <Info className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                        <p className="font-semibold">{m['server.files.insideArchive.title']()}</p>
                        <p className="mt-0.5 text-[var(--color-warning)]/90">
                            {m['server.files.insideArchive.body']({ name: insideArchive })}
                        </p>
                    </div>
                </div>
            )}

            {/* ── Over-cap warning ── */}
            {filtered.length > DISPLAY_CAP && (
                <div className="mb-3 rounded-[var(--radius-card)] border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-3 py-2 text-center text-xs text-[var(--color-warning)]">
                    {searchTerm
                        ? m['server.files.matchesCapped']({ count: filtered.length, cap: DISPLAY_CAP })
                        : m['server.files.directoryCapped']({ cap: DISPLAY_CAP })}
                </div>
            )}

            <div>
                <div className="min-w-0">
                    {isError ? (
                        <ErrorState onRetry={() => refetch()} />
                    ) : isLoading || !files ? (
                        <div className="flex justify-center py-16">
                            <Spinner className="h-8 w-8" />
                        </div>
                    ) : filtered.length === 0 ? (
                        <p className="py-16 text-center text-sm text-[var(--color-ink-faint)]">
                            {searchTerm ? m['server.files.noMatches']() : m['server.files.emptyDirectory']()}
                        </p>
                    ) : gridView ? (
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
                            {display.map(file => (
                                <GridCard
                                    key={file.key}
                                    file={file}
                                    selected={selected.includes(file.name)}
                                    onOpen={() => openEntry(file)}
                                    onToggle={() => toggleSelect(file.name)}
                                    caps={caps}
                                    actions={actions}
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="overflow-hidden rounded-md border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70">
                            <table className="w-full border-collapse text-sm">
                                <thead>
                                    <tr className="border-b border-[var(--color-border-strong)] text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">
                                        <th className="w-10 px-3 py-3">
                                            <input
                                                type="checkbox"
                                                className="accent-[var(--brand)]"
                                                checked={allSelected}
                                                onChange={toggleSelectAll}
                                                aria-label={m['server.files.selectAll']()}
                                            />
                                        </th>
                                        <SortHeader
                                            label={m['server.files.col.name']()}
                                            active={sortField === 'name'}
                                            dir={sortDirection}
                                            onClick={() => toggleSort('name')}
                                        />
                                        <SortHeader
                                            label={m['server.files.col.size']()}
                                            active={sortField === 'size'}
                                            dir={sortDirection}
                                            onClick={() => toggleSort('size')}
                                            className="hidden text-right sm:table-cell"
                                        />
                                        <SortHeader
                                            label={m['server.files.col.modified']()}
                                            active={sortField === 'modified'}
                                            dir={sortDirection}
                                            onClick={() => toggleSort('modified')}
                                            className="hidden text-right md:table-cell"
                                        />
                                        <th className="w-10 px-3 py-2.5" />
                                    </tr>
                                </thead>
                                <tbody>
                                    {display.map(file => (
                                        <Row
                                            key={file.key}
                                            file={file}
                                            selected={selected.includes(file.name)}
                                            onToggle={() => toggleSelect(file.name)}
                                            onOpen={() => openEntry(file)}
                                            caps={caps}
                                            actions={actions}
                                        />
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* ── Status bar ── */}
                    {files && filtered.length > 0 && (
                        <div className="mt-3 flex items-center justify-between px-1 text-xs text-[var(--color-ink-faint)]">
                            <span>
                                {m['server.files.itemCount']({ count: display.length })}
                                {totalSize > 0 && ` · ${formatBytes(totalSize)}`}
                            </span>
                            {filtered.length > DISPLAY_CAP && <span>{m['server.files.showingFirst']({ cap: DISPLAY_CAP })}</span>}
                        </div>
                    )}
                </div>
            </div>

            {/* ── Connection details drawer (overlays, doesn't shift layout) ── */}
            {canSftp && <ConnectionPanel open={showConnection} onClose={() => setShowConnection(false)} />}

            {/* ── Long-running archive job indicator ── */}
            {busy && (
                <div className="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4">
                    <div className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 py-2 text-sm text-[var(--color-ink-muted)] shadow-2xl shadow-black/40">
                        <Spinner className="h-4 w-4" />
                        {busy}
                    </div>
                </div>
            )}

            {/* ── Mass actions bar ── */}
            {selected.length > 0 && (
                <div className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
                    <div className="pointer-events-auto flex items-center gap-3 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 py-2 shadow-2xl shadow-black/40">
                        <span className="text-sm text-[var(--color-ink-muted)]">
                            {m['server.files.selectedCount']({ count: selected.length })}
                        </span>
                        {canUpdate && (
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setRename({ files: selected, mode: 'move' })}
                            >
                                <FolderInput className="h-4 w-4" />
                                {m['server.files.move']()}
                            </Button>
                        )}
                        {canArchive && (
                            <Button
                                variant="secondary"
                                size="sm"
                                disabled={compressMutation.isPending}
                                onClick={() => compressMutation.mutate(selected)}
                            >
                                <Package className="h-4 w-4" />
                                {m['server.files.compress.action']()}
                            </Button>
                        )}
                        {canArchive && server.isNodeSupercharged && (
                            <Button variant="ghost" size="sm" onClick={() => setCompressFormat(selected)}>
                                {m['server.files.compress.as']()}
                            </Button>
                        )}
                        {canUpdate && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setChmod({ files: selected, mode: '' })}
                            >
                                <Settings2 className="h-4 w-4" />
                                {m['server.files.chmod.action']()}
                            </Button>
                        )}
                        {canDelete && (
                            <Button variant="danger" size="sm" onClick={() => setConfirmDelete(selected)}>
                                <Trash2 className="h-4 w-4" />
                                {m['common.actions.delete']()}
                            </Button>
                        )}
                        <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
                            {m['common.actions.cancel']()}
                        </Button>
                    </div>
                </div>
            )}

            {/* ── Modals ── */}
            <NewDirectoryModal uuid={uuid} directory={directory} open={showNewDir} onClose={() => setShowNewDir(false)} />
            {canCreate && <PullModal uuid={uuid} directory={directory} open={showPull} onClose={() => setShowPull(false)} />}
            {rename && (
                <RenameMoveModal
                    uuid={uuid}
                    directory={directory}
                    files={rename.files}
                    mode={rename.mode}
                    open
                    onClose={() => setRename(null)}
                    onDone={() => setSelected([])}
                />
            )}
            {compressFormat && server.isNodeSupercharged && (
                <CompressModal
                    uuid={uuid}
                    directory={directory}
                    files={compressFormat}
                    open
                    onClose={() => setCompressFormat(null)}
                    onDone={() => setSelected([])}
                />
            )}
            {chmod && (
                <ChmodModal
                    uuid={uuid}
                    directory={directory}
                    files={chmod.files}
                    initialMode={chmod.mode}
                    open
                    onClose={() => setChmod(null)}
                    onDone={() => setSelected([])}
                />
            )}
            {checksum && server.isNodeSupercharged && (
                <ChecksumModal
                    uuid={uuid}
                    files={checksum.map(name => join(directory, name))}
                    open
                    onClose={() => setChecksum(null)}
                />
            )}
            {archiveAction && (
                <ArchiveActionModal
                    name={archiveAction.name}
                    openable={supercharged && isVirtualArchive(archiveAction)}
                    canExtract={canCreate}
                    canDownload={canReadContent}
                    open
                    onOpen={() => openArchiveInline(archiveAction)}
                    onExtract={() => extractMutation.mutate({ name: archiveAction.name, open: true })}
                    onDownload={() => void download(archiveAction.name)}
                    onClose={() => setArchiveAction(null)}
                />
            )}
            {server.isNodeSupercharged && (
                <FileSearchModal
                    uuid={uuid}
                    serverId={id}
                    directory={directory}
                    open={showSearch}
                    onClose={() => setShowSearch(false)}
                />
            )}
            <ConfirmDialog
                open={!!confirmDelete}
                onClose={() => setConfirmDelete(null)}
                title={m['server.files.deleteTitle']()}
                body={m['server.files.deleteBody']({ count: confirmDelete?.length ?? 0 })}
                confirmLabel={m['common.actions.delete']()}
                cancelLabel={m['common.actions.cancel']()}
                busy={deleteMutation.isPending}
                onConfirm={() => confirmDelete && deleteMutation.mutate(confirmDelete)}
            />
        </div>
    );
}

function Breadcrumbs({ serverId, crumbs }: { serverId: string; crumbs: { label: string; path: string }[] }) {
    return (
        <nav className="flex min-w-0 items-center gap-1 text-sm">
            <Link
                to={`/server/${serverId}/files`}
                className="rounded px-1.5 py-0.5 font-medium text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
            >
                {m['server.files.root']()}
            </Link>
            {crumbs.map(c => (
                <span key={c.path} className="flex min-w-0 items-center gap-1">
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-faint)]" />
                    <Link
                        to={{ hash: encodePathSegments(c.path) }}
                        className="truncate rounded px-1.5 py-0.5 text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]"
                    >
                        {c.label}
                    </Link>
                </span>
            ))}
        </nav>
    );
}

function SortHeader({
    label,
    active,
    dir,
    onClick,
    className = '',
}: {
    label: string;
    active: boolean;
    dir: SortDirection;
    onClick: () => void;
    className?: string;
}) {
    return (
        <th className={`px-3 py-2.5 font-semibold ${className}`}>
            <button
                onClick={onClick}
                className={`inline-flex items-center gap-1 ${active ? 'text-[var(--color-ink)]' : 'hover:text-[var(--color-ink-muted)]'}`}
            >
                {label}
                {active &&
                    (dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
            </button>
        </th>
    );
}

// Toolbar sort control. Duplicates the list-header sorting but is the only way
// to reach it in grid view, and adds "Type" (which has no column of its own).
function SortMenu({
    field,
    dir,
    onSelect,
}: {
    field: SortField;
    dir: SortDirection;
    onSelect: (f: SortField) => void;
}) {
    const options: { value: SortField; label: string }[] = [
        { value: 'name', label: m['server.files.col.name']() },
        { value: 'size', label: m['server.files.col.size']() },
        { value: 'modified', label: m['server.files.col.modified']() },
        { value: 'type', label: m['server.files.col.type']() },
    ];
    return (
        <Dropdown.Root>
            <Dropdown.Trigger
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[var(--color-border)] px-2.5 text-sm text-[var(--color-ink-muted)] transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-ink)] focus:outline-none"
                title={m['server.files.sortBy']()}
            >
                <ArrowDownUp className="h-4 w-4" />
                {dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
            </Dropdown.Trigger>
            <Dropdown.Portal>
                <Dropdown.Content
                    align="end"
                    sideOffset={4}
                    className="z-[60] min-w-[9rem] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-1 shadow-xl shadow-black/30"
                >
                    {options.map(o => (
                        <Dropdown.Item
                            key={o.value}
                            onSelect={() => onSelect(o.value)}
                            className="flex cursor-pointer select-none items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm text-[var(--color-ink)] outline-none data-[highlighted]:bg-[var(--color-surface-2)]"
                        >
                            {o.label}
                            {field === o.value &&
                                (dir === 'asc' ? (
                                    <ArrowUp className="h-3.5 w-3.5 text-[var(--brand)]" />
                                ) : (
                                    <ArrowDown className="h-3.5 w-3.5 text-[var(--brand)]" />
                                ))}
                        </Dropdown.Item>
                    ))}
                </Dropdown.Content>
            </Dropdown.Portal>
        </Dropdown.Root>
    );
}

// Shared capability flags + per-file action handlers. Both the list row and the
// grid card render the same FileActionsMenu from these, so the two views never
// drift apart.
interface FileCaps {
    canUpdate: boolean;
    canCreate: boolean;
    canDelete: boolean;
    canArchive: boolean;
    canReadContent: boolean;
    supercharged: boolean;
}
interface FileActions {
    edit: (f: FileObject) => void;
    rename: (f: FileObject) => void;
    move: (f: FileObject) => void;
    copy: (f: FileObject) => void;
    compress: (f: FileObject) => void;
    compressAs: (f: FileObject) => void;
    extract: (f: FileObject, open: boolean) => void;
    chmod: (f: FileObject) => void;
    checksum: (f: FileObject) => void;
    download: (f: FileObject) => void;
    downloadDir: (f: FileObject) => void;
    remove: (f: FileObject) => void;
}

function Row({
    file,
    selected,
    onToggle,
    onOpen,
    caps,
    actions,
}: {
    file: FileObject;
    selected: boolean;
    onToggle: () => void;
    onOpen: () => void;
    caps: FileCaps;
    actions: FileActions;
}) {
    return (
        <tr
            onClick={onOpen}
            className="group cursor-pointer border-b border-[var(--color-border)] transition-colors last:border-0 hover:bg-[var(--color-surface-2)]/40"
        >
            <td className="px-3 py-3.5" onClick={e => e.stopPropagation()}>
                <input
                    type="checkbox"
                    className="accent-[var(--brand)]"
                    checked={selected}
                    onChange={onToggle}
                    aria-label={file.name}
                />
            </td>
            <td className="px-3 py-3.5">
                <span className="flex min-w-0 items-center gap-2.5">
                    <FileTypeIcon file={file} openable={caps.supercharged && isVirtualArchive(file)} />
                    <span
                        className={`truncate text-[15px] ${file.isFile ? 'text-[var(--color-ink)]' : 'font-medium text-[var(--color-ink)]'} group-hover:text-[var(--color-accent)]`}
                    >
                        {file.name}
                    </span>
                    {file.isSymlink && (
                        <span className="text-[10px] uppercase tracking-wide text-[var(--color-ink-faint)]">
                            {m['server.files.symlink']()}
                        </span>
                    )}
                </span>
            </td>
            <td className="hidden px-3 py-3.5 text-right font-mono text-xs tabular-nums text-[var(--color-ink-muted)] sm:table-cell">
                {file.isFile ? formatBytes(file.size) : '—'}
            </td>
            <td className="hidden px-3 py-3.5 text-right text-xs text-[var(--color-ink-muted)] md:table-cell">
                {timeAgo(file.modifiedAt)}
            </td>
            <td className="px-3 py-3.5 text-right" onClick={e => e.stopPropagation()}>
                <FileActionsMenu file={file} caps={caps} actions={actions} />
            </td>
        </tr>
    );
}

function FileActionsMenu({
    file,
    caps,
    actions,
    align = 'end',
}: {
    file: FileObject;
    caps: FileCaps;
    actions: FileActions;
    align?: 'start' | 'end';
}) {
    const { canUpdate, canCreate, canDelete, canArchive, canReadContent, supercharged } = caps;
    const archived = isArchive(file);
    return (
        <Dropdown.Root>
            <Dropdown.Trigger className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] focus:outline-none">
                <MoreVertical className="h-4 w-4" />
            </Dropdown.Trigger>
            <Dropdown.Portal>
                <Dropdown.Content
                    align={align}
                    sideOffset={4}
                    className="z-[60] min-w-[9rem] rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-1 shadow-xl shadow-black/30"
                >
                    {file.isFile && isEditable(file) && canUpdate && canReadContent && (
                        <MenuItem icon={Pencil} label={m['common.actions.edit']()} onSelect={() => actions.edit(file)} />
                    )}
                    {canUpdate && (
                        <MenuItem icon={Pencil} label={m['server.files.rename']()} onSelect={() => actions.rename(file)} />
                    )}
                    {canUpdate && (
                        <MenuItem icon={FolderInput} label={m['server.files.move']()} onSelect={() => actions.move(file)} />
                    )}
                    {canUpdate && (
                        <MenuItem
                            icon={Settings2}
                            label={m['server.files.chmod.action']()}
                            onSelect={() => actions.chmod(file)}
                        />
                    )}
                    {file.isFile && canCreate && (
                        <MenuItem icon={Copy} label={m['server.files.copy']()} onSelect={() => actions.copy(file)} />
                    )}
                    {/* Extract runs against /files/decompress, which both the Go
                        daemon and wings-rs implement — one action, either daemon. */}
                    {archived && canCreate && (
                        <>
                            <MenuItem
                                icon={PackageOpen}
                                label={m['server.files.extract']()}
                                onSelect={() => actions.extract(file, false)}
                            />
                            <MenuItem
                                icon={FolderOpen}
                                label={m['server.files.extractAndOpen']()}
                                onSelect={() => actions.extract(file, true)}
                            />
                        </>
                    )}
                    {!archived && canArchive && (
                        <MenuItem
                            icon={Package}
                            label={m['server.files.compress.action']()}
                            onSelect={() => actions.compress(file)}
                        />
                    )}
                    {!archived && canArchive && supercharged && (
                        <MenuItem
                            icon={FileArchive}
                            label={m['server.files.compress.as']()}
                            onSelect={() => actions.compressAs(file)}
                        />
                    )}
                    {/* Checksums are a wings-rs feature (file.read). */}
                    {file.isFile && supercharged && (
                        <MenuItem
                            icon={Fingerprint}
                            label={m['server.files.checksum.action']()}
                            onSelect={() => actions.checksum(file)}
                        />
                    )}
                    {file.isFile && canReadContent && (
                        <MenuItem
                            icon={Download}
                            label={m['server.files.download']()}
                            onSelect={() => actions.download(file)}
                        />
                    )}
                    {/* Folders stream as an on-the-fly archive (file.read-content) —
                        no temp file left behind, unlike Compress. */}
                    {!file.isFile && canReadContent && (
                        <MenuItem
                            icon={Download}
                            label={m['server.files.downloadArchive']()}
                            onSelect={() => actions.downloadDir(file)}
                        />
                    )}
                    {canDelete && (
                        <MenuItem
                            icon={Trash2}
                            label={m['common.actions.delete']()}
                            onSelect={() => actions.remove(file)}
                            danger
                        />
                    )}
                </Dropdown.Content>
            </Dropdown.Portal>
        </Dropdown.Root>
    );
}

function MenuItem({
    icon: Icon,
    label,
    onSelect,
    danger,
}: {
    icon: typeof Pencil;
    label: string;
    onSelect: () => void;
    danger?: boolean;
}) {
    return (
        <Dropdown.Item
            onSelect={onSelect}
            className={`flex cursor-pointer select-none items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-[highlighted]:bg-[var(--color-surface-2)] ${
                danger ? 'text-[var(--color-danger)]' : 'text-[var(--color-ink)]'
            }`}
        >
            <Icon className="h-3.5 w-3.5" /> {label}
        </Dropdown.Item>
    );
}

function GridCard({
    file,
    selected,
    onOpen,
    onToggle,
    caps,
    actions,
}: {
    file: FileObject;
    selected: boolean;
    onOpen: () => void;
    onToggle: () => void;
    caps: FileCaps;
    actions: FileActions;
}) {
    return (
        <div
            onClick={onOpen}
            className={`group relative flex cursor-pointer flex-col items-center gap-2 rounded-[var(--radius-card)] border p-4 transition-colors ${
                selected
                    ? 'border-[var(--brand)] bg-[var(--brand)]/8'
                    : 'border-[var(--color-border)] hover:bg-[var(--color-surface-2)]/50'
            }`}
        >
            <input
                type="checkbox"
                className="absolute left-2 top-2 accent-[var(--brand)] opacity-0 transition-opacity group-hover:opacity-100"
                checked={selected}
                onChange={onToggle}
                onClick={e => e.stopPropagation()}
                aria-label={file.name}
            />
            {/* Same per-file menu as the list view — grid users had no actions before. */}
            <div
                className="absolute right-1 top-1 opacity-0 transition-opacity group-hover:opacity-100 data-[open]:opacity-100"
                onClick={e => e.stopPropagation()}
            >
                <FileActionsMenu file={file} caps={caps} actions={actions} />
            </div>
            <div className="scale-[1.7] py-2">
                <FileTypeIcon file={file} openable={caps.supercharged && isVirtualArchive(file)} />
            </div>
            <span className="w-full truncate text-center text-sm text-[var(--color-ink)] group-hover:text-[var(--color-accent)]">
                {file.name}
            </span>
            <span className="text-[11px] text-[var(--color-ink-faint)]">
                {file.isFile ? formatBytes(file.size) : m['server.files.folder']()}
            </span>
        </div>
    );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
    return (
        <div className="flex flex-col items-center gap-3 py-16">
            <p className="text-sm text-[var(--color-danger)]">{m['server.files.loadError']()}</p>
            <Button variant="outline" size="sm" onClick={onRetry}>
                {m['common.actions.retry']()}
            </Button>
        </div>
    );
}

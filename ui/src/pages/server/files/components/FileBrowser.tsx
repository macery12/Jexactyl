import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Dropdown from '@radix-ui/react-dropdown-menu';
import {
    ChevronRight,
    Copy,
    Download,
    File as FileIcon,
    FileArchive,
    Folder,
    FolderInput,
    FolderPlus,
    FilePlus,
    LayoutGrid,
    List as ListIcon,
    MoreVertical,
    Network,
    Pencil,
    Search,
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
    deleteFiles,
    getFileDownloadUrl,
    isArchive,
    isEditable,
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

type SortField = 'name' | 'size' | 'modified';
type SortDirection = 'asc' | 'desc';
const DISPLAY_CAP = 250;

function sortFiles(files: FileObject[], field: SortField, dir: SortDirection): FileObject[] {
    const sorted = [...files].sort((a, b) => {
        if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
        let cmp: number;
        if (field === 'name') cmp = a.name.localeCompare(b.name);
        else if (field === 'modified') cmp = a.modifiedAt.getTime() - b.modifiedAt.getTime();
        else cmp = a.size - b.size;
        return dir === 'asc' ? cmp : -cmp;
    });
    // Drop adjacent duplicates by name (V1 parity — daemon can double-report).
    return sorted.filter((f, i) => i === 0 || f.name !== sorted[i - 1]?.name);
}

function FileTypeIcon({ file }: { file: FileObject }) {
    if (!file.isFile) return <Folder className="h-[18px] w-[18px] shrink-0 text-[var(--brand)]" />;
    if (isArchive(file)) return <FileArchive className="h-[18px] w-[18px] shrink-0 text-[var(--color-warning)]" />;
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

    const { data: files, isLoading, isError, refetch } = useQuery({
        queryKey: ['server-files', uuid, directory],
        queryFn: () => loadDirectory(uuid, directory),
    });

    // Reset transient state whenever the directory changes.
    useEffect(() => {
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

    const openEntry = (file: FileObject) => {
        if (!file.isFile) {
            navigate({ hash: encodePathSegments(join(directory, file.name)) });
        } else if (isEditable(file)) {
            navigate(`/v2/server/${id}/files/edit/${encodePathSegments(join(directory, file.name))}`);
        } else {
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

    const copyMutation = useMutation({
        mutationFn: (name: string) => copyFile(uuid, join(directory, name)),
        onSuccess: async () => {
            push({ type: 'success', message: m['server.files.copied']() });
            await qc.invalidateQueries({ queryKey: ['server-files', uuid, directory] });
        },
        onError: (e: unknown) => push({ type: 'error', message: firstError(e) ?? m['common.states.genericError']() }),
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
                            <Button
                                size="sm"
                                onClick={() => navigate(`/v2/server/${id}/files/new${window.location.hash}`)}
                            >
                                <FilePlus className="h-4 w-4" />
                                {m['server.files.newFile']()}
                            </Button>
                        </>
                    )}
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9"
                        title={gridView ? m['server.files.listView']() : m['server.files.gridView']()}
                        onClick={() => setGridView(!gridView)}
                    >
                        {gridView ? <ListIcon className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
                    </Button>
                    {canSftp && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-9 w-9"
                            title={m['server.files.connection.title']()}
                            onClick={() => setShowConnection(v => !v)}
                        >
                            <Network className="h-4 w-4" />
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
                                            canUpdate={canUpdate}
                                            canCreate={canCreate}
                                            canDelete={canDelete}
                                            onEdit={() =>
                                                navigate(
                                                    `/v2/server/${id}/files/edit/${encodePathSegments(join(directory, file.name))}`,
                                                )
                                            }
                                            onRename={() => setRename({ files: [file.name], mode: 'rename' })}
                                            onMove={() => setRename({ files: [file.name], mode: 'move' })}
                                            onCopy={() => copyMutation.mutate(file.name)}
                                            onDownload={() => download(file.name)}
                                            onDelete={() => setConfirmDelete([file.name])}
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
                to={`/v2/server/${serverId}/files`}
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

function Row({
    file,
    selected,
    onToggle,
    onOpen,
    canUpdate,
    canCreate,
    canDelete,
    onEdit,
    onRename,
    onMove,
    onCopy,
    onDownload,
    onDelete,
}: {
    file: FileObject;
    selected: boolean;
    onToggle: () => void;
    onOpen: () => void;
    canUpdate: boolean;
    canCreate: boolean;
    canDelete: boolean;
    onEdit: () => void;
    onRename: () => void;
    onMove: () => void;
    onCopy: () => void;
    onDownload: () => void;
    onDelete: () => void;
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
                    <FileTypeIcon file={file} />
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
                <RowMenu
                    file={file}
                    canUpdate={canUpdate}
                    canCreate={canCreate}
                    canDelete={canDelete}
                    onEdit={onEdit}
                    onRename={onRename}
                    onMove={onMove}
                    onCopy={onCopy}
                    onDownload={onDownload}
                    onDelete={onDelete}
                />
            </td>
        </tr>
    );
}

function RowMenu({
    file,
    canUpdate,
    canCreate,
    canDelete,
    onEdit,
    onRename,
    onMove,
    onCopy,
    onDownload,
    onDelete,
}: {
    file: FileObject;
    canUpdate: boolean;
    canCreate: boolean;
    canDelete: boolean;
    onEdit: () => void;
    onRename: () => void;
    onMove: () => void;
    onCopy: () => void;
    onDownload: () => void;
    onDelete: () => void;
}) {
    return (
        <Dropdown.Root>
            <Dropdown.Trigger className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-[var(--color-ink-faint)] transition-colors hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)] focus:outline-none">
                <MoreVertical className="h-4 w-4" />
            </Dropdown.Trigger>
            <Dropdown.Portal>
                <Dropdown.Content
                    align="end"
                    sideOffset={4}
                    className="z-[60] min-w-[9rem] rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] p-1 shadow-xl shadow-black/30"
                >
                    {file.isFile && isEditable(file) && canUpdate && (
                        <MenuItem icon={Pencil} label={m['common.actions.edit']()} onSelect={onEdit} />
                    )}
                    {canUpdate && <MenuItem icon={Pencil} label={m['server.files.rename']()} onSelect={onRename} />}
                    {canUpdate && <MenuItem icon={FolderInput} label={m['server.files.move']()} onSelect={onMove} />}
                    {file.isFile && canCreate && <MenuItem icon={Copy} label={m['server.files.copy']()} onSelect={onCopy} />}
                    {file.isFile && <MenuItem icon={Download} label={m['server.files.download']()} onSelect={onDownload} />}
                    {canDelete && (
                        <MenuItem icon={Trash2} label={m['common.actions.delete']()} onSelect={onDelete} danger />
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
}: {
    file: FileObject;
    selected: boolean;
    onOpen: () => void;
    onToggle: () => void;
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
            <div className="scale-[1.7] py-2">
                <FileTypeIcon file={file} />
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

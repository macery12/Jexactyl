import http from '@/lib/http';

// Client file-manager endpoints (/api/client/servers/{uuid}/files/*), ported
// from V1's routes/server/{files,directories}.ts. All paths are relative to the
// server root; `directory`/`root` is the current folder, `file` the full path.

export interface FileObject {
    key: string;
    name: string;
    mode: string;
    modeBits: string;
    size: number;
    isFile: boolean;
    isSymlink: boolean;
    mimetype: string;
    createdAt: Date;
    modifiedAt: Date;
}

// Archive extensions/mimetypes — used to gate the "editable" and "archive"
// affordances (mirrors V1's FileObject.isArchiveType / isEditable helpers).
const ARCHIVE_EXTENSIONS = [
    '.zip', '.7z', '.ddup', '.rar', '.tar', '.tar.gz', '.tgz', '.tar.bz2', '.tbz2',
    '.tar.xz', '.txz', '.tar.zst', '.tzst', '.tar.lz4', '.tlz4', '.tar.br',
    '.gz', '.xz', '.zst', '.lz4', '.bz2',
];
const ARCHIVE_MIMETYPES = [
    'application/vnd.rar', 'application/x-rar-compressed', 'application/x-tar', 'application/x-br',
    'application/x-bzip2', 'application/gzip', 'application/x-gzip', 'application/x-lzip',
    'application/x-sz', 'application/x-xz', 'application/zstd', 'application/zip',
    'application/x-zip-compressed', 'application/x-7z-compressed',
];

export function isArchive(file: FileObject): boolean {
    if (!file.isFile) return false;
    const lower = file.name.toLowerCase();
    return ARCHIVE_EXTENSIONS.some(ext => lower.endsWith(ext)) || ARCHIVE_MIMETYPES.includes(file.mimetype);
}

export function isEditable(file: FileObject): boolean {
    if (!file.isFile || file.isSymlink) return false;
    return !isArchive(file);
}

interface FractalFile {
    attributes: {
        name: string;
        mode: string;
        mode_bits: string;
        size: number | string;
        is_file: boolean;
        is_symlink: boolean;
        mimetype: string;
        created_at: string;
        modified_at: string;
    };
}

function toFileObject({ attributes: a }: FractalFile): FileObject {
    return {
        key: `${a.is_file ? 'file' : 'dir'}_${a.name}`,
        name: a.name,
        mode: a.mode,
        modeBits: a.mode_bits,
        size: Number(a.size),
        isFile: a.is_file,
        isSymlink: a.is_symlink,
        mimetype: a.mimetype,
        createdAt: new Date(a.created_at),
        modifiedAt: new Date(a.modified_at),
    };
}

export async function loadDirectory(uuid: string, directory: string): Promise<FileObject[]> {
    const { data } = await http.get(`/api/client/servers/${uuid}/files/list`, {
        params: { directory: directory || '/' },
    });
    return (data.data ?? []).map(toFileObject);
}

export async function createDirectory(uuid: string, root: string, name: string): Promise<void> {
    await http.post(`/api/client/servers/${uuid}/files/create-folder`, { root, name });
}

export async function renameFiles(
    uuid: string,
    root: string,
    files: { from: string; to: string }[],
): Promise<void> {
    await http.put(`/api/client/servers/${uuid}/files/rename`, { root, files });
}

export async function copyFile(uuid: string, location: string): Promise<void> {
    await http.post(`/api/client/servers/${uuid}/files/copy`, { location });
}

export async function deleteFiles(uuid: string, root: string, files: string[]): Promise<void> {
    await http.post(`/api/client/servers/${uuid}/files/delete`, { root, files });
}

export async function getFileContents(
    uuid: string,
    file: string,
    options?: { signal?: AbortSignal },
): Promise<string> {
    const { data } = await http.get(`/api/client/servers/${uuid}/files/contents`, {
        params: { file },
        transformResponse: res => res,
        responseType: 'text',
        headers: { Accept: 'text/plain' },
        signal: options?.signal,
    });
    return data;
}

export async function saveFileContents(
    uuid: string,
    file: string,
    content: string,
    originalContent?: string,
): Promise<void> {
    if (originalContent !== undefined) {
        await http.post(`/api/client/servers/${uuid}/files/write-with-diff`, {
            file,
            content,
            original_content: originalContent,
        });
    } else {
        await http.post(`/api/client/servers/${uuid}/files/write`, content, {
            params: { file },
            headers: { 'Content-Type': 'text/plain' },
        });
    }
}

export async function getFileDownloadUrl(uuid: string, file: string): Promise<string> {
    const { data } = await http.get(`/api/client/servers/${uuid}/files/download`, { params: { file } });
    return data.attributes.url;
}

export async function getFileUploadUrl(uuid: string): Promise<string> {
    const { data } = await http.get(`/api/client/servers/${uuid}/files/upload`);
    return data.attributes.url;
}

// ── Wings-RS (Supercharged nodes only) ──────────────────────────────────────
export interface SearchResult {
    path: string;
    name: string;
    size: number;
    modified: string;
    is_file: boolean;
    mime_type?: string;
}

export async function searchFiles(
    uuid: string,
    params: { root?: string; pattern: string; glob?: boolean; regex?: boolean; case_sensitive?: boolean },
): Promise<SearchResult[]> {
    const { data } = await http.post(`/api/client/servers/${uuid}/wings-rs/search`, params);
    return Array.isArray(data) ? data : [];
}

export interface SshInfo {
    host: string;
    port: number;
    username: string;
    command?: string;
    containerSupported: boolean;
}

export async function getSshInfo(uuid: string): Promise<SshInfo> {
    const { data } = await http.get(`/api/client/servers/${uuid}/wings-rs/ssh`);
    return {
        host: data?.host ?? data?.ip ?? '',
        port: Number(data?.port ?? 22),
        username: data?.username ?? '',
        command: data?.command,
        containerSupported: Boolean(data?.container_supported ?? data?.shell_available ?? false),
    };
}

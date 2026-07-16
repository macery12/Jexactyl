import http from '@/lib/http';

// Per-server backups, backed by the existing client API
// (/api/client/servers/{id}/backups, paginated Fractal collection of
// BackupTransformer). `backup_count` in the meta block counts every backup the
// server has against its feature limit, which is not the same as the current
// page's length — the create button gates on that count, not on items.length.

export interface Backup {
    uuid: string;
    name: string;
    isSuccessful: boolean;
    isLocked: boolean;
    ignoredFiles: string[];
    checksum: string | null;
    bytes: number;
    createdAt: string;
    /** null while the daemon is still generating the archive. */
    completedAt: string | null;
}

export interface BackupPagination {
    currentPage: number;
    totalPages: number;
    total: number;
    perPage: number;
}

export interface BackupPage {
    items: Backup[];
    pagination: BackupPagination;
    /** Total backups on the server, across every page. */
    backupCount: number;
}

interface RawBackupRow {
    attributes: {
        uuid: string;
        name: string;
        is_successful: boolean;
        is_locked: boolean;
        ignored_files?: string[];
        checksum?: string | null;
        bytes?: number;
        created_at: string;
        completed_at?: string | null;
    };
}

function mapBackup(row: RawBackupRow): Backup {
    const a = row.attributes;
    return {
        uuid: a.uuid,
        name: a.name,
        isSuccessful: a.is_successful,
        isLocked: a.is_locked,
        ignoredFiles: a.ignored_files ?? [],
        checksum: a.checksum ?? null,
        bytes: a.bytes ?? 0,
        createdAt: a.created_at,
        completedAt: a.completed_at ?? null,
    };
}

// GET /api/client/servers/{id}/backups
export async function getBackups(server: string, page = 1): Promise<BackupPage> {
    const { data } = await http.get(`/api/client/servers/${server}/backups`, { params: { page } });
    const p = data.meta?.pagination ?? {};

    return {
        items: (data.data ?? []).map(mapBackup),
        pagination: {
            currentPage: p.current_page ?? 1,
            totalPages: p.total_pages ?? 1,
            total: p.total ?? 0,
            perPage: p.per_page ?? 20,
        },
        backupCount: data.meta?.backup_count ?? 0,
    };
}

// POST /api/client/servers/{id}/backups
export async function createBackup(
    server: string,
    input: { name?: string; ignored?: string; isLocked: boolean },
): Promise<Backup> {
    const { data } = await http.post(`/api/client/servers/${server}/backups`, {
        name: input.name || undefined,
        ignored: input.ignored || undefined,
        is_locked: input.isLocked,
    });
    return mapBackup(data);
}

// GET /api/client/servers/{id}/backups/{backup}/download — returns a signed,
// short-lived URL pointing at the node rather than streaming through the panel.
export async function getBackupDownloadUrl(server: string, backup: string): Promise<string> {
    const { data } = await http.get(`/api/client/servers/${server}/backups/${backup}/download`);
    return data.attributes.url;
}

// POST /api/client/servers/{id}/backups/{backup}/restore
export async function restoreBackup(server: string, backup: string, truncate: boolean): Promise<void> {
    await http.post(`/api/client/servers/${server}/backups/${backup}/restore`, { truncate });
}

// POST /api/client/servers/{id}/backups/{backup}/lock — toggles, not sets.
export async function toggleBackupLock(server: string, backup: string): Promise<void> {
    await http.post(`/api/client/servers/${server}/backups/${backup}/lock`);
}

// DELETE /api/client/servers/{id}/backups/{backup}
export async function deleteBackup(server: string, backup: string): Promise<void> {
    await http.delete(`/api/client/servers/${server}/backups/${backup}`);
}

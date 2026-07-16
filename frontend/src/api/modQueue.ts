import http from '@/lib/http';

// Download-queue client for the server marketplace. The queue drives both the
// header badge (poll) and the Queue tab. Item fields stay snake_case to match
// the backend payload verbatim (phase encodes modpack progress, e.g. "mods:2/4").

export interface DownloadQueueItem {
    uuid: string;
    provider: string;
    source: string;
    project_id: string;
    file_id: string;
    file_name: string | null;
    error_message: string | null;
    install_log: string | null;
    total_children: number | null;
    completed_children: number | null;
    failed_children: number | null;
    status: 'pending' | 'downloading' | 'completed' | 'failed';
    phase: string | null;
    started_at: string | null;
    completed_at: string | null;
    created_at: string;
}

export const getQueue = (server: string): Promise<DownloadQueueItem[]> =>
    http.get(`/api/client/servers/${server}/mods/queue`).then(r => r.data?.data ?? []);

export const cancelQueueItem = (server: string, queueId: string): Promise<void> =>
    http.delete(`/api/client/servers/${server}/mods/queue/${queueId}`).then(() => {});

export const retryQueueItem = (server: string, queueId: string): Promise<{ queued: boolean; queue_id: string }> =>
    http.post(`/api/client/servers/${server}/mods/queue/${queueId}/retry`).then(r => r.data);

export interface BulkClearResponse {
    deleted: number;
}

// When active downloads are present the backend returns 409 with an
// `active_count`; pass force=true to clear them anyway (surfaced via a confirm).
export const bulkClearQueue = (server: string, uuids?: string[], force = false): Promise<BulkClearResponse> =>
    http
        .post(`/api/client/servers/${server}/mods/queue/bulk-clear`, { uuids: uuids ?? null, force })
        .then(r => r.data);

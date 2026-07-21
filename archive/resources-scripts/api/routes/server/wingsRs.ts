import http from '@/api/http';

export interface WingsRsStatus {
    supercharged: boolean;
    wings_type: string;
    wings_version: string | null;
    features: string[];
}

export interface FileFingerprint {
    path: string;
    algorithm: string;
    hash: string;
}

export interface SearchResult {
    path: string;
    name: string;
    size: number;
    modified: string;
    is_file: boolean;
    mime_type?: string;
}

export interface CompressRequest {
    root: string;
    files: string[];
    format: 'tar' | 'tar_gz' | 'tar_xz' | 'tar_bz2' | 'tar_lz4' | 'tar_zstd' | 'zip' | 'seven_zip';
    name?: string;
    foreground?: boolean;
}

export interface CompressResult {
    operation_id?: string;
    file?: string;
}

export interface ScriptRequest {
    container_image?: string;
    entrypoint?: string;
    script: string;
    environment?: Record<string, string>;
}

export type ArchiveFormat = 'tar' | 'tar_gz' | 'tar_xz' | 'tar_bz2' | 'tar_lz4' | 'tar_zstd' | 'zip' | 'seven_zip';

export const getWingsRsStatus = (uuid: string): Promise<WingsRsStatus> => {
    return http.get(`/api/client/servers/${uuid}/wings-rs/status`).then(({ data }) => ({
        supercharged: Boolean(data?.supercharged),
        wings_type: data?.wings_type ?? 'default',
        wings_version: data?.wings_version ?? null,
        features: Array.isArray(data?.features) ? data.features : [],
    }));
};

export const getFingerprints = (
    uuid: string,
    root: string,
    files: string[],
    algorithm?: string,
): Promise<FileFingerprint[]> => {
    return http
        .post(`/api/client/servers/${uuid}/wings-rs/fingerprints`, { root, files, algorithm })
        .then(({ data }) => data);
};

export const searchFiles = (
    uuid: string,
    params: {
        root?: string;
        pattern: string;
        glob?: boolean;
        regex?: boolean;
        case_sensitive?: boolean;
    },
): Promise<SearchResult[]> => {
    return http.post(`/api/client/servers/${uuid}/wings-rs/search`, params).then(({ data }) => data);
};

export const compressAdvanced = (uuid: string, data: CompressRequest): Promise<CompressResult> => {
    return http
        .post(`/api/client/servers/${uuid}/wings-rs/compress`, data, {
            timeout: 10000,
            timeoutErrorMessage: 'The compression is taking a while. It will complete in the background.',
        })
        .then(({ data }) => data);
};

export const cancelOperation = (uuid: string, operationId: string): Promise<void> => {
    return http.delete(`/api/client/servers/${uuid}/wings-rs/operations/${operationId}`);
};

export const runScript = (uuid: string, data: ScriptRequest): Promise<void> => {
    return http.post(`/api/client/servers/${uuid}/wings-rs/script`, data);
};

export const abortInstall = (uuid: string): Promise<void> => {
    return http.post(`/api/client/servers/${uuid}/wings-rs/abort-install`);
};

export const getInstallLogs = (uuid: string, lines?: number): Promise<string[]> => {
    return http.get(`/api/client/servers/${uuid}/wings-rs/install-logs`, { params: { lines } }).then(({ data }) => {
        if (Array.isArray(data)) {
            return data;
        }

        if (Array.isArray(data?.content)) {
            return data.content;
        }

        if (typeof data?.content === 'string') {
            return data.content.split('\n');
        }

        if (typeof data === 'string') {
            return data.split('\n');
        }

        return [];
    });
};

export interface SshInfo {
    host: string;
    port: number;
    username: string;
    command?: string;
    container_supported: boolean;
}

export const getSshInfo = (uuid: string): Promise<SshInfo> => {
    return http.get(`/api/client/servers/${uuid}/wings-rs/ssh`).then(({ data }) => ({
        host: data?.host ?? data?.ip ?? '',
        port: Number(data?.port ?? 22),
        username: data?.username ?? '',
        command: data?.command,
        container_supported: Boolean(data?.container_supported ?? data?.shell_available ?? false),
    }));
};

import http from '@/api/http';

export interface WingsRsDetectionResult {
    detected: boolean;
    wings_type: string;
    wings_version: string | null;
}

export interface SystemOverview {
    version: string;
    rust_version?: string;
    build_date?: string;
    os: string;
    arch: string;
    kernel: string;
    uptime?: number;
    features: string[];
}

export interface SystemStats {
    cpu: {
        used: number;
        threads: number;
        model: string;
    };
    network: {
        received_rate: number;
        sent_rate: number;
    };
    memory: {
        used: number;
        process: number;
        total: number;
    };
    disk: {
        used: number;
        total: number;
        read_rate: number;
        write_rate: number;
    };
}

export interface LogFile {
    name: string;
    size: number;
    modified: string;
}

export const detectWingsRs = (nodeId: number): Promise<WingsRsDetectionResult> => {
    return http.post(`/api/application/nodes/${nodeId}/wings-rs/detect`).then(({ data }) => data);
};

export const getSystemOverview = (nodeId: number): Promise<SystemOverview> => {
    return http.get(`/api/application/nodes/${nodeId}/wings-rs/overview`).then(({ data }) => ({
        version: data?.version ?? 'unknown',
        rust_version: data?.rust_version ?? data?.rust,
        build_date: data?.build_date ?? data?.build,
        os: data?.os ?? data?.container_type ?? 'unknown',
        arch: data?.arch ?? data?.architecture ?? 'unknown',
        kernel: data?.kernel ?? data?.kernel_version ?? 'unknown',
        uptime: data?.uptime !== undefined ? Number(data?.uptime) : undefined,
        features: Array.isArray(data?.features) ? data.features : [],
    }));
};

export const getSystemStats = (nodeId: number): Promise<SystemStats> => {
    return http.get(`/api/application/nodes/${nodeId}/wings-rs/stats`).then(({ data }) => {
        const stats = data?.stats ?? data;

        return {
            cpu: {
                used: Number(stats?.cpu?.used ?? stats?.cpu_used ?? 0),
                threads: Number(stats?.cpu?.threads ?? stats?.cpu_threads ?? 0),
                model: stats?.cpu?.model ?? stats?.cpu_model ?? 'Unknown',
            },
            network: {
                received_rate: Number(
                    stats?.network?.receiving_rate ??
                        stats?.network?.received_rate ??
                        stats?.network_receiving_rate ??
                        0,
                ),
                sent_rate: Number(
                    stats?.network?.sending_rate ?? stats?.network?.sent_rate ?? stats?.network_sending_rate ?? 0,
                ),
            },
            memory: {
                used: Number(stats?.memory?.used ?? stats?.memory_used ?? 0),
                process: Number(stats?.memory?.used_process ?? stats?.memory?.process ?? stats?.memory_process ?? 0),
                total: Number(stats?.memory?.total ?? stats?.memory_total ?? 0),
            },
            disk: {
                used: Number(stats?.disk?.used ?? stats?.disk_used ?? 0),
                total: Number(stats?.disk?.total ?? stats?.disk_total ?? 0),
                read_rate: Number(stats?.disk?.reading_rate ?? stats?.disk?.read_rate ?? stats?.disk_reading_rate ?? 0),
                write_rate: Number(
                    stats?.disk?.writing_rate ?? stats?.disk?.write_rate ?? stats?.disk_writing_rate ?? 0,
                ),
            },
        };
    });
};

export const getSystemLogs = (nodeId: number): Promise<LogFile[]> => {
    return http.get(`/api/application/nodes/${nodeId}/wings-rs/logs`).then(({ data }) => {
        const items = Array.isArray(data) ? data : (data?.log_files ?? data?.files);

        if (!Array.isArray(items)) {
            return [];
        }

        return items.map((entry: any) => ({
            name: entry?.name ?? entry?.file ?? 'unknown.log',
            size: Number(entry?.size ?? 0),
            modified: entry?.modified ?? entry?.updated_at ?? '',
        }));
    });
};

export const getSystemLogContents = (nodeId: number, file: string, lines?: number): Promise<string[]> => {
    return http
        .get(`/api/application/nodes/${nodeId}/wings-rs/logs/${file}`, { params: { lines } })
        .then(({ data }) => {
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

export interface UpgradeRequest {
    url: string;
    sha256?: string;
    restart_command?: string;
}

export const upgradeNode = (nodeId: number, data: UpgradeRequest): Promise<void> => {
    return http.post(`/api/application/nodes/${nodeId}/wings-rs/upgrade`, data);
};

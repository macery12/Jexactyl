import http from '@/api/http';

export interface AdminServerWingsStatus {
    supercharged: boolean;
    wings_type: string;
    wings_version: string | null;
}

export interface AdminServerSystemStats {
    cpu: { used: number; threads: number; model: string };
    network: { receiving_rate: number; sending_rate: number };
    memory: { used: number; used_process: number; total: number };
    disk: { used: number; total: number; reading_rate: number; writing_rate: number };
}

export const getAdminServerWingsStatus = (serverId: number): Promise<AdminServerWingsStatus> => {
    return http.get(`/api/application/servers/${serverId}/wings-rs/status`).then(({ data }) => data);
};

export const getAdminServerWingsStats = (serverId: number): Promise<AdminServerSystemStats> => {
    return http.get(`/api/application/servers/${serverId}/wings-rs/stats`).then(({ data }) => {
        const stats = data?.stats ?? data;

        return {
            cpu: {
                used: Number(stats?.cpu?.used ?? 0),
                threads: Number(stats?.cpu?.threads ?? 0),
                model: stats?.cpu?.model ?? 'Unknown',
            },
            network: {
                receiving_rate: Number(stats?.network?.receiving_rate ?? 0),
                sending_rate: Number(stats?.network?.sending_rate ?? 0),
            },
            memory: {
                used: Number(stats?.memory?.used ?? 0),
                used_process: Number(stats?.memory?.used_process ?? 0),
                total: Number(stats?.memory?.total ?? 0),
            },
            disk: {
                used: Number(stats?.disk?.used ?? 0),
                total: Number(stats?.disk?.total ?? 0),
                reading_rate: Number(stats?.disk?.reading_rate ?? 0),
                writing_rate: Number(stats?.disk?.writing_rate ?? 0),
            },
        };
    });
};

export const getAdminServerInstallLogs = (
    serverId: number,
    lines = 100,
): Promise<{ content: string[]; missing: boolean }> => {
    return http
        .get(`/api/application/servers/${serverId}/wings-rs/install-logs`, { params: { lines } })
        .then(({ data }) => {
            const raw = data?.content;

            if (Array.isArray(raw)) {
                return { content: raw, missing: Boolean(data?.missing) };
            }

            if (typeof raw === 'string') {
                return { content: raw.length ? raw.split('\n') : [], missing: Boolean(data?.missing) };
            }

            return { content: [], missing: Boolean(data?.missing) };
        });
};

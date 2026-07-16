import http from '@/api/http';

const base = (uuid: string) => `/api/client/servers/${uuid}/extensions/discordsrv_helper`;

export interface DiscordSrvHelperStatus {
    installed: boolean;
    plugin_jar: string | null;
    plugin_folder_present: boolean;
    token_file_present: boolean;
    config_present: boolean;
}

export interface DiscordSrvHelperHistoryEntry {
    id: number;
    action: string;
    created_at: string;
    actor: { id: number; email: string } | null;
}

export interface DiscordSrvHelperSubuserAccess {
    uuid: string;
    email: string;
    username: string;
    disabled: boolean;
}

export const getDiscordSrvHelperStatus = async (uuid: string): Promise<DiscordSrvHelperStatus> => {
    const { data } = await http.get(`${base(uuid)}/status`);
    return data;
};

export const installDiscordSrv = async (uuid: string, jarUrl?: string): Promise<void> => {
    await http.post(`${base(uuid)}/install`, jarUrl ? { jar_url: jarUrl } : {});
};

export const setDiscordSrvToken = async (uuid: string, token: string): Promise<void> => {
    await http.post(`${base(uuid)}/token`, { token });
};

export const setDiscordSrvGlobalChannel = async (uuid: string, channelId: string): Promise<void> => {
    await http.post(`${base(uuid)}/channel`, { channel_id: channelId });
};

export const getDiscordSrvHistory = async (uuid: string): Promise<DiscordSrvHelperHistoryEntry[]> => {
    const { data } = await http.get(`${base(uuid)}/history`);
    return data.data || [];
};

export const revertDiscordSrvHistory = async (uuid: string, snapshotId: number): Promise<void> => {
    await http.post(`${base(uuid)}/history/${snapshotId}/revert`);
};

export const getDiscordSrvSubusers = async (uuid: string): Promise<DiscordSrvHelperSubuserAccess[]> => {
    const { data } = await http.get(`${base(uuid)}/subusers`);
    return data.data || [];
};

export const setDiscordSrvSubuserAccess = async (
    uuid: string,
    subuserUuid: string,
    enabled: boolean,
): Promise<void> => {
    await http.post(`${base(uuid)}/subusers/${subuserUuid}`, { enabled });
};

import http from '@/api/http';

export interface ServerExtension {
    id: string;
    name: string;
    description: string;
    icon: string;
    version: string;
    route: string;
}

export const getServerExtensions = async (uuid: string): Promise<ServerExtension[]> => {
    const { data } = await http.get(`/api/client/servers/${uuid}/extensions`);
    return data.data;
};

export const checkExtensionEnabled = async (uuid: string, extensionId: string): Promise<boolean> => {
    const { data } = await http.get(`/api/client/servers/${uuid}/extensions/${extensionId}`);
    return data.enabled;
};

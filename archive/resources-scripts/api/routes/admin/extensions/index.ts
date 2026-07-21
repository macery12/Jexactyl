import http from '@/api/http';

export interface ExtensionSettingOption {
    label: string;
    value: string | number | boolean;
}

export type ExtensionSettingFieldType = 'text' | 'password' | 'textarea' | 'select' | 'boolean' | 'number';

export interface ExtensionSettingField {
    key: string;
    label: string;
    type: ExtensionSettingFieldType;
    help?: string;
    placeholder?: string;
    options?: ExtensionSettingOption[];
}

export interface ExtensionSourceInfo {
    type: 'core' | 'repository';
    label: string;
    official: boolean;
    repositoryId: number | null;
    repositoryName: string | null;
    homepageUrl: string | null;
    securityWarning: string | null;
}

export interface ExtensionData {
    id: string;
    name: string;
    description: string;
    version: string;
    latestVersion?: string;
    author: string;
    icon: string;
    route?: string;
    enabled: boolean;
    allowedNests: number[];
    allowedEggs: number[];
    settings: Record<string, unknown>;
    settingsSchema?: ExtensionSettingField[];
    installed?: boolean;
    installable?: boolean;
    canUninstall?: boolean;
    status?: 'core' | 'installed' | 'available';
    updateAvailable?: boolean;
    compatiblePanelVersions?: string[];
    source?: ExtensionSourceInfo;
}

export interface ExtensionRepositoryData {
    id: number;
    slug: string;
    name: string;
    manifestUrl: string;
    homepageUrl: string | null;
    enabled: boolean;
    official: boolean;
    packagesCount: number;
    securityWarning: string;
    status?: 'ok' | 'error' | 'disabled';
    error?: string;
}

export interface NestOption {
    id: number;
    uuid: string;
    name: string;
    description: string | null;
}

export interface EggOption {
    id: number;
    uuid: string;
    name: string;
    description: string | null;
    nestId: number;
    nestName: string;
}

export interface NestsAndEggs {
    nests: NestOption[];
    eggs: EggOption[];
}

export const getExtensions = async (): Promise<ExtensionData[]> => {
    const { data } = await http.get('/api/application/extensions');
    return data.data;
};

export const refreshExtensions = async (): Promise<ExtensionData[]> => {
    const { data } = await http.post('/api/application/extensions/refresh');
    return data.data;
};

export const getExtension = async (extensionId: string): Promise<ExtensionData> => {
    const { data } = await http.get(`/api/application/extensions/${extensionId}`);
    return data.attributes ?? data;
};

export const updateExtension = async (
    extensionId: string,
    allowedNests: number[],
    allowedEggs: number[],
    settings: Record<string, unknown> = {},
): Promise<ExtensionData> => {
    const { data } = await http.put(`/api/application/extensions/${extensionId}`, {
        allowed_nests: allowedNests,
        allowed_eggs: allowedEggs,
        settings,
    });
    return data.attributes ?? data;
};

export const toggleExtension = async (extensionId: string): Promise<ExtensionData> => {
    const { data } = await http.post(`/api/application/extensions/${extensionId}/toggle`);
    return data.attributes ?? data;
};

export interface InstallProgress {
    action: 'install' | 'uninstall' | 'update' | 'batch-install' | 'batch-uninstall' | 'batch-update';
    extension_id: string;
    stage: string;
    updated_at: string;
    batch_total?: number;
    batch_current?: number;
    batch_extensions?: string[];
}

export const getInstallProgress = async (): Promise<InstallProgress | null> => {
    const { data } = await http.get('/api/application/extensions/progress');
    return data.progress ?? null;
};

export const installExtension = async (
    extensionId: string,
    repositoryId: number,
    version?: string,
): Promise<ExtensionData> => {
    const { data } = await http.post(
        `/api/application/extensions/${extensionId}/install`,
        { repository_id: repositoryId, version },
        { timeout: 300000 },
    );

    return data.attributes ?? data;
};

export const uninstallExtension = async (extensionId: string): Promise<ExtensionData> => {
    const { data } = await http.post(`/api/application/extensions/${extensionId}/uninstall`, {}, { timeout: 300000 });

    return data.attributes ?? data;
};

export const upgradeExtension = async (
    extensionId: string,
    repositoryId: number,
    version?: string,
): Promise<ExtensionData> => {
    const { data } = await http.post(
        `/api/application/extensions/${extensionId}/update-package`,
        { repository_id: repositoryId, version },
        { timeout: 300000 },
    );

    return data.attributes ?? data;
};

export const updateModuleSettings = async (enabled: boolean): Promise<void> => {
    await http.put('/api/application/extensions/settings', { key: 'enabled', value: enabled });
};

export const getNestsAndEggs = async (): Promise<NestsAndEggs> => {
    const { data } = await http.get('/api/application/extensions/nests-eggs');
    return data;
};

export const getRepositories = async (): Promise<ExtensionRepositoryData[]> => {
    const { data } = await http.get('/api/application/extensions/repositories');
    return data.data;
};

export const createRepository = async (payload: {
    name: string;
    manifestUrl: string;
    homepageUrl?: string;
    enabled?: boolean;
    acknowledgeRisk: boolean;
}): Promise<ExtensionRepositoryData> => {
    const { data } = await http.post('/api/application/extensions/repositories', {
        name: payload.name,
        manifest_url: payload.manifestUrl,
        homepage_url: payload.homepageUrl,
        enabled: payload.enabled ?? true,
        acknowledge_risk: payload.acknowledgeRisk,
    });

    return data.attributes ?? data;
};

export const updateRepository = async (
    repositoryId: number,
    payload: Partial<{ name: string; manifestUrl: string; homepageUrl: string | null; enabled: boolean }>,
): Promise<ExtensionRepositoryData> => {
    const { data } = await http.patch(`/api/application/extensions/repositories/${repositoryId}`, {
        name: payload.name,
        manifest_url: payload.manifestUrl,
        homepage_url: payload.homepageUrl,
        enabled: payload.enabled,
    });

    return data.attributes ?? data;
};

export const deleteRepository = async (repositoryId: number): Promise<void> => {
    await http.delete(`/api/application/extensions/repositories/${repositoryId}`);
};

export interface BatchInstallItem {
    extensionId: string;
    repositoryId: number;
    version?: string;
}

export const batchInstallExtensions = async (items: BatchInstallItem[]): Promise<ExtensionData[]> => {
    const { data } = await http.post(
        '/api/application/extensions/batch-install',
        {
            extensions: items.map(item => ({
                extension_id: item.extensionId,
                repository_id: item.repositoryId,
                version: item.version,
            })),
        },
        { timeout: 1800000 },
    );
    return data.data;
};

export const batchUninstallExtensions = async (extensionIds: string[]): Promise<ExtensionData[]> => {
    const { data } = await http.post(
        '/api/application/extensions/batch-uninstall',
        { extension_ids: extensionIds },
        { timeout: 1800000 },
    );
    return data.data;
};

export const batchUpdateExtensions = async (items: BatchInstallItem[]): Promise<ExtensionData[]> => {
    const { data } = await http.post(
        '/api/application/extensions/batch-update',
        {
            extensions: items.map(item => ({
                extension_id: item.extensionId,
                repository_id: item.repositoryId,
                version: item.version,
            })),
        },
        { timeout: 1800000 },
    );
    return data.data;
};

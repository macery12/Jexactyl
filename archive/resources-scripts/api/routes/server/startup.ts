import http, { FractalResponseList } from '@/api/http';
import { EggVariable, Transformers } from '@definitions/server';
import { AxiosError } from 'axios';
import useSWR, { SWRConfiguration } from 'swr';

interface StartupVariableVersionOption {
    value: string;
    label: string;
    stable: boolean;
}

interface StartupVariableVersionResponse {
    key: string;
    supported: boolean;
    provider: string | null;
    supportsSnapshots: boolean;
    includeSnapshots: boolean;
    stale: boolean;
    error: string | null;
    context: Record<string, string>;
    options: StartupVariableVersionOption[];
}

const getServerStartup = (
    uuid: string,
    fallbackData?: { invocation: string; variables: EggVariable[]; dockerImages: Record<string, string> },
    config?: SWRConfiguration<
        { invocation: string; variables: EggVariable[]; dockerImages: Record<string, string> },
        AxiosError
    >,
) =>
    useSWR(
        [uuid, '/startup'],
        async (): Promise<{ invocation: string; variables: EggVariable[]; dockerImages: Record<string, string> }> => {
            const { data } = await http.get(`/api/client/servers/${uuid}/startup`);

            const variables = ((data as FractalResponseList).data || []).map(Transformers.toEggVariable);

            return {
                variables,
                invocation: data.meta.startup_command,
                dockerImages: data.meta.docker_images || {},
            };
        },
        { fallbackData, errorRetryCount: 3, ...(config ?? {}) },
    );

const setImage = async (uuid: string, image: string): Promise<void> => {
    await http.put(`/api/client/servers/${uuid}/settings/docker-image`, { docker_image: image });
};

const changeEgg = async (uuid: string, eggId: number, deleteFiles = false): Promise<void> => {
    await http.post(`/api/client/servers/${uuid}/settings/change-egg`, { egg_id: eggId, delete_files: deleteFiles });
};

const updateStartupVariable = async (uuid: string, key: string, value: string): Promise<[EggVariable, string]> => {
    const { data } = await http.put(`/api/client/servers/${uuid}/startup/variable`, { key, value });

    return [Transformers.toEggVariable(data), data.meta.startup_command];
};

const getStartupVariableVersionOptions = async (
    uuid: string,
    key: string,
    includeSnapshots = false,
    context: Record<string, string> = {},
): Promise<StartupVariableVersionResponse> => {
    const { data } = await http.get(`/api/client/servers/${uuid}/startup/versions`, {
        params: {
            key,
            include_snapshots: includeSnapshots ? 1 : 0,
            context,
        },
    });

    const attributes = data.attributes || {};

    return {
        key: attributes.key,
        supported: !!attributes.supported,
        provider: attributes.provider ?? null,
        supportsSnapshots: !!attributes.supports_snapshots,
        includeSnapshots: !!attributes.include_snapshots,
        stale: !!attributes.stale,
        error: attributes.error ?? null,
        context: attributes.context ?? {},
        options: (attributes.options ?? []) as StartupVariableVersionOption[],
    };
};

export { getServerStartup, setImage, changeEgg, updateStartupVariable, getStartupVariableVersionOptions };
export type { StartupVariableVersionOption, StartupVariableVersionResponse };

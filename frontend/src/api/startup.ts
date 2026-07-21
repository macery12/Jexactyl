import http from '@/lib/http';

// Client startup endpoints (/api/client/servers/{uuid}/startup + settings),
// ported from V1's routes/server/startup.ts. Drives the egg-variable editor:
// each variable renders as text/switch/select based on its validation rules,
// and the live invocation string previews the resolved startup command.

export interface EggVariable {
    name: string;
    description: string;
    envVariable: string;
    defaultValue: string;
    serverValue: string | null;
    isEditable: boolean;
    rules: string[];
}

export interface StartupData {
    invocation: string;
    variables: EggVariable[];
    dockerImages: Record<string, string>;
    rawStartupCommand: string;
}

interface FractalVariable {
    attributes: {
        name: string;
        description: string;
        env_variable: string;
        default_value: string;
        server_value: string | null;
        is_editable: boolean;
        rules: string;
    };
}

function toVariable({ attributes: a }: FractalVariable): EggVariable {
    return {
        name: a.name,
        description: a.description,
        envVariable: a.env_variable,
        defaultValue: a.default_value,
        serverValue: a.server_value,
        isEditable: a.is_editable,
        rules: (a.rules ?? '').split('|').filter(Boolean),
    };
}

export async function getStartup(uuid: string): Promise<StartupData> {
    const { data } = await http.get(`/api/client/servers/${uuid}/startup`);
    return {
        variables: (data.data ?? []).map(toVariable),
        invocation: data.meta?.startup_command ?? '',
        rawStartupCommand: data.meta?.raw_startup_command ?? '',
        dockerImages: data.meta?.docker_images ?? {},
    };
}

// Updates a single variable and returns the recomputed invocation string.
export async function updateStartupVariable(
    uuid: string,
    key: string,
    value: string,
): Promise<{ variable: EggVariable; invocation: string }> {
    const { data } = await http.put(`/api/client/servers/${uuid}/startup/variable`, { key, value });
    return { variable: toVariable(data), invocation: data.meta?.startup_command ?? '' };
}

export async function setDockerImage(uuid: string, image: string): Promise<void> {
    await http.put(`/api/client/servers/${uuid}/settings/docker-image`, { docker_image: image });
}

// ── Version helper ──────────────────────────────────────────────────────────
// A handful of well-known version variables (Vanilla/Paper/Forge/Sponge/…) can
// be resolved to a live list of installable versions server-side. Env vars in
// this set get an assisted "Versions" picker instead of a bare text field.
export const VERSION_HELPER_VARIABLES = new Set([
    'VANILLA_VERSION',
    'MINECRAFT_VERSION',
    'MC_VERSION',
    'BUNGEE_VERSION',
    'BUILD_NUMBER',
    'FORGE_VERSION',
    'SPONGE_VERSION',
]);

export interface VersionOption {
    value: string;
    label: string;
    stable: boolean;
}

export interface VersionOptions {
    supported: boolean;
    supportsSnapshots: boolean;
    includeSnapshots: boolean;
    stale: boolean;
    error: string | null;
    options: VersionOption[];
}

export async function getStartupVersions(
    uuid: string,
    key: string,
    includeSnapshots = false,
    context: Record<string, string> = {},
): Promise<VersionOptions> {
    const { data } = await http.get(`/api/client/servers/${uuid}/startup/versions`, {
        params: { key, include_snapshots: includeSnapshots ? 1 : 0, context },
    });
    const a = data.attributes ?? {};
    return {
        supported: !!a.supported,
        supportsSnapshots: !!a.supports_snapshots,
        includeSnapshots: !!a.include_snapshots,
        stale: !!a.stale,
        error: a.error ?? null,
        options: (a.options ?? []) as VersionOption[],
    };
}

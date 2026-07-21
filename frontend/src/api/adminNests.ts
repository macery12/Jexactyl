import http from '@/lib/http';

// Admin nests + eggs + egg variables. Sourced from the session-authed
// application API (/api/application/{nests,eggs}) — the same surface V1's admin
// service area used. This is the *full* admin view-model (create/edit/import/
// export). The slim read-only `@/api/nests` module stays as-is for the preset
// editor and server builder; this one owns the Nests management page.

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AdminNest {
    id: number;
    uuid: string;
    author: string;
    name: string;
    description: string | null;
    eggCount: number;
    createdAt: string;
    updatedAt: string;
}

export interface AdminEggListItem {
    id: number;
    nestId: number;
    name: string;
    description: string | null;
    variableCount: number;
    serverCount: number;
}

export type EggFieldType = 'text' | 'password' | 'number' | 'boolean';

export interface AdminEggVariable {
    id: number;
    eggId: number;
    name: string;
    description: string;
    environmentVariable: string;
    defaultValue: string;
    isUserViewable: boolean;
    isUserEditable: boolean;
    fieldType: EggFieldType;
    rules: string;
}

export interface AdminEggDetail {
    id: number;
    uuid: string;
    nestId: number;
    author: string;
    name: string;
    description: string | null;
    features: string[];
    dockerImages: Record<string, string>;
    fileDenylist: string[];
    forceOutgoingIp: boolean;
    updateUrl: string | null;
    configFiles: Record<string, unknown> | null;
    configStartup: Record<string, unknown> | null;
    configStop: string | null;
    startup: string;
    scriptContainer: string;
    scriptEntry: string;
    scriptIsPrivileged: boolean;
    scriptInstall: string | null;
    serverCount: number;
    variables: AdminEggVariable[];
    createdAt: string;
    updatedAt: string;
}

// Normalized payload used by both create and edit. Docker images are edited as
// image→alias rows in the UI and collapsed to the API's { alias: image } map.
export interface EggPayload {
    name: string;
    description: string;
    startup: string;
    configStop: string;
    updateUrl: string | null;
    dockerImages: Record<string, string>;
    configStartup: string;
    configFiles: string;
    features: string[];
    fileDenylist: string[];
    forceOutgoingIp: boolean;
    scriptContainer: string;
    scriptEntry: string;
    scriptInstall: string;
    scriptIsPrivileged: boolean;
}

// ─── Transformers ─────────────────────────────────────────────────────────────

function attrs(row: any): any {
    return row.attributes ?? row;
}

function relCount(a: any, name: string): number {
    return (a.relationships?.[name]?.data ?? []).length;
}

function toNest(row: any): AdminNest {
    const a = attrs(row);
    return {
        id: a.id,
        uuid: a.uuid,
        author: a.author,
        name: a.name,
        description: a.description ?? null,
        eggCount: relCount(a, 'eggs'),
        createdAt: a.created_at,
        updatedAt: a.updated_at,
    };
}

function toEggListItem(row: any): AdminEggListItem {
    const a = attrs(row);
    return {
        id: a.id,
        nestId: a.nest_id,
        name: a.name,
        description: a.description ?? null,
        variableCount: relCount(a, 'variables'),
        serverCount: relCount(a, 'servers'),
    };
}

function toEggVariable(row: any): AdminEggVariable {
    const v = attrs(row);
    return {
        id: v.id,
        eggId: v.egg_id,
        name: v.name ?? '',
        description: v.description ?? '',
        environmentVariable: v.env_variable ?? '',
        defaultValue: v.default_value ?? '',
        isUserViewable: Boolean(v.user_viewable),
        isUserEditable: Boolean(v.user_editable),
        fieldType: (v.field_type as EggFieldType) || 'text',
        rules: v.rules ?? '',
    };
}

function toEggDetail(row: any): AdminEggDetail {
    const a = attrs(row);
    return {
        id: a.id,
        uuid: a.uuid,
        nestId: a.nest_id,
        author: a.author,
        name: a.name,
        description: a.description ?? null,
        features: a.features ?? [],
        dockerImages: a.docker_images ?? {},
        fileDenylist: a.config?.file_denylist ?? [],
        forceOutgoingIp: Boolean(a.force_outgoing_ip),
        updateUrl: a.update_url ?? null,
        configFiles: a.config?.files ?? null,
        configStartup: a.config?.startup ?? null,
        configStop: a.config?.stop ?? null,
        startup: a.startup ?? '',
        scriptContainer: a.script?.container ?? '',
        scriptEntry: a.script?.entry ?? '',
        scriptIsPrivileged: Boolean(a.script?.privileged),
        scriptInstall: a.script?.install ?? null,
        serverCount: relCount(a, 'servers'),
        variables: (a.relationships?.variables?.data ?? []).map(toEggVariable),
        createdAt: a.created_at,
        updatedAt: a.updated_at,
    };
}

// Map the normalized payload to the snake_case body the application API expects.
function eggBody(p: Partial<EggPayload> & { nestId?: number }): Record<string, unknown> {
    return {
        nest_id: p.nestId,
        name: p.name,
        description: p.description,
        features: p.features,
        docker_images: p.dockerImages,
        file_denylist: p.fileDenylist,
        config_files: p.configFiles,
        config_startup: p.configStartup,
        config_stop: p.configStop,
        startup: p.startup,
        force_outgoing_ip: p.forceOutgoingIp,
        update_url: p.updateUrl,
        script_container: p.scriptContainer,
        script_entry: p.scriptEntry,
        script_is_privileged: p.scriptIsPrivileged,
        script_install: p.scriptInstall,
    };
}

// ─── Nests ────────────────────────────────────────────────────────────────────

// Every nest with its egg count. The index caps per_page, so page through.
export async function listNests(): Promise<AdminNest[]> {
    const out: AdminNest[] = [];
    let page = 1;
    for (let safety = 0; safety < 50; safety++) {
        const { data } = await http.get('/api/application/nests', {
            params: { include: 'eggs', per_page: 100, page },
        });
        out.push(...(data.data ?? []).map(toNest));
        const pagination = data.meta?.pagination;
        if (!pagination || page >= (pagination.total_pages ?? 1)) break;
        page += 1;
    }
    return out;
}

export async function createNest(name: string, description: string, author: string): Promise<AdminNest> {
    const { data } = await http.post('/api/application/nests', { name, description, author }, { params: { include: 'eggs' } });
    return toNest(data);
}

export async function updateNest(id: number, name: string, description: string, author: string): Promise<AdminNest> {
    const { data } = await http.patch(`/api/application/nests/${id}`, { name, description, author }, { params: { include: 'eggs' } });
    return toNest(data);
}

export async function deleteNest(id: number): Promise<void> {
    await http.delete(`/api/application/nests/${id}`);
}

// ─── Eggs ─────────────────────────────────────────────────────────────────────

export async function listNestEggs(nestId: number): Promise<AdminEggListItem[]> {
    if (!nestId || nestId < 1) return [];
    const { data } = await http.get(`/api/application/nests/${nestId}/eggs`, {
        params: { include: 'variables,servers', per_page: 100 },
    });
    return (data.data ?? []).map(toEggListItem);
}

export async function getEggDetail(eggId: number): Promise<AdminEggDetail> {
    const { data } = await http.get(`/api/application/eggs/${eggId}`, {
        params: { include: 'variables,servers' },
    });
    return toEggDetail(data);
}

export async function createEgg(nestId: number, payload: EggPayload): Promise<AdminEggDetail> {
    const { data } = await http.post('/api/application/eggs', eggBody({ ...payload, nestId }));
    return toEggDetail(data);
}

export async function updateEgg(id: number, payload: Partial<EggPayload>): Promise<AdminEggDetail> {
    const { data } = await http.patch(`/api/application/eggs/${id}`, eggBody(payload));
    return toEggDetail(data);
}

export async function deleteEgg(id: number): Promise<void> {
    await http.delete(`/api/application/eggs/${id}`);
}

// Import a JSON egg definition into a nest. Accepts the parsed egg object.
export async function importEgg(nestId: number, json: unknown): Promise<void> {
    await http.post(`/api/application/nests/${nestId}/import`, json, {
        headers: { 'Content-Type': 'application/json' },
    });
}

// The export endpoint returns the egg definition object; stringify it for the
// editor preview and the downloaded file.
export async function exportEgg(eggId: number): Promise<string> {
    const { data } = await http.get(`/api/application/eggs/${eggId}/export`);
    return JSON.stringify(data, null, 4);
}

// ─── Egg variables ────────────────────────────────────────────────────────────

export interface NewEggVariable {
    name: string;
    description: string;
    environmentVariable: string;
    defaultValue: string;
    isUserViewable: boolean;
    isUserEditable: boolean;
    fieldType: EggFieldType;
    rules: string;
}

function variableBody(v: NewEggVariable): Record<string, unknown> {
    return {
        name: v.name,
        description: v.description,
        env_variable: v.environmentVariable,
        default_value: v.defaultValue,
        user_viewable: v.isUserViewable,
        user_editable: v.isUserEditable,
        field_type: v.fieldType,
        rules: v.rules,
    };
}

export async function createEggVariable(eggId: number, variable: NewEggVariable): Promise<AdminEggVariable> {
    const { data } = await http.post(`/api/application/eggs/${eggId}/variables`, variableBody(variable));
    return toEggVariable(data);
}

// Bulk-save existing variables (edits + reorder). Each entry carries its id.
export async function updateEggVariables(eggId: number, variables: AdminEggVariable[]): Promise<AdminEggVariable[]> {
    const { data } = await http.patch(
        `/api/application/eggs/${eggId}/variables`,
        variables.map(v => ({ id: v.id, ...variableBody(v) })),
    );
    return (data.data ?? []).map(toEggVariable);
}

export async function deleteEggVariable(eggId: number, variableId: number): Promise<void> {
    await http.delete(`/api/application/eggs/${eggId}/variables/${variableId}`);
}

// ─── Helpers shared with the UI ───────────────────────────────────────────────

export interface DockerRow {
    image: string;
    alias: string;
}

// Docker images arrive as { alias: image }; edit them as image|alias rows.
export function dockerMapToRows(map: Record<string, string>): DockerRow[] {
    const rows = Object.entries(map).map(([alias, image]) => ({ image, alias }));
    return rows.length > 0 ? rows : [{ image: '', alias: '' }];
}

export function dockerRowsToMap(rows: DockerRow[]): Record<string, string> {
    const map: Record<string, string> = {};
    for (const row of rows) {
        const image = row.image.trim();
        if (image.length < 1) continue;
        const alias = row.alias.trim() || image;
        map[alias] = image;
    }
    return map;
}

export function parseLines(value: string): string[] {
    return value
        .split('\n')
        .map(v => v.trim())
        .filter(v => v.length > 0);
}

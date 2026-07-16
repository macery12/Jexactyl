import http from '@/lib/http';

// Server presets — reusable cpu/memory/disk + egg bundles used by the
// create-from-preset flow. Backed by /api/application/servers/presets.

export interface ServerPreset {
    id: number;
    uuid: string;
    name: string;
    description: string | null;
    memory: number;
    disk: number;
    cpu: number;
    nestId: number | null;
    eggId: number | null;
}

export interface PresetFormValues {
    name: string;
    description?: string | null;
    memory: number;
    cpu: number;
    disk: number;
    nest_id?: number | null;
    egg_id?: number | null;
}

// Presets are returned as a plain (non-Fractal) model array — the transformer
// emits `$model->toArray()`, so attributes are top-level rows under `data`.
function toPreset(a: any): ServerPreset {
    return {
        id: a.id,
        uuid: a.uuid,
        name: a.name,
        description: a.description && a.description.length > 0 ? a.description : null,
        memory: Number(a.memory ?? 0),
        disk: Number(a.disk ?? 0),
        cpu: Number(a.cpu ?? 0),
        nestId: a.nest_id ?? null,
        eggId: a.egg_id ?? null,
    };
}

export async function getServerPresets(): Promise<ServerPreset[]> {
    const { data } = await http.get('/api/application/servers/presets', { params: { per_page: 100 } });
    return (data.data ?? []).map((row: any) => toPreset(row.attributes ?? row));
}

export async function createServerPreset(values: PresetFormValues): Promise<void> {
    await http.post('/api/application/servers/presets', values);
}

export async function updateServerPreset(id: number, values: PresetFormValues): Promise<void> {
    await http.patch(`/api/application/servers/presets/${id}`, values);
}

export async function deleteServerPreset(id: number): Promise<void> {
    await http.delete(`/api/application/servers/presets/${id}`);
}

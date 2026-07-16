import http from '@/lib/http';

// Nests, eggs and egg variables — used by the preset editor (nest→egg pickers)
// and the manual server builder (egg defaults: docker image, startup, env vars).

export interface Nest {
    id: number;
    name: string;
    description: string | null;
}

export interface Egg {
    id: number;
    nestId: number;
    name: string;
}

export interface EggVariable {
    envVariable: string;
    name: string;
    defaultValue: string;
    rules: string | null;
}

export interface EggDetail extends Egg {
    dockerImages: Record<string, string> | string[];
    startup: string;
    variables: EggVariable[];
}

export async function getNests(): Promise<Nest[]> {
    const { data } = await http.get('/api/application/nests', { params: { per_page: 100 } });
    return (data.data ?? []).map((row: any) => {
        const a = row.attributes ?? row;
        return { id: a.id, name: a.name, description: a.description ?? null };
    });
}

export async function getNestEggs(nestId: number): Promise<Egg[]> {
    // Guard against an unset/0 nest id (nests are 1-indexed) — calling
    // /nests/0/eggs would 404. Treat it as "no eggs yet".
    if (!nestId || nestId < 1) return [];
    const { data } = await http.get(`/api/application/nests/${nestId}/eggs`, { params: { per_page: 100 } });
    return (data.data ?? []).map((row: any) => {
        const a = row.attributes ?? row;
        return { id: a.id, nestId: a.nest_id, name: a.name };
    });
}

export async function getEgg(id: number): Promise<EggDetail> {
    const { data } = await http.get(`/api/application/eggs/${id}`, { params: { include: 'variables' } });
    const a = data.attributes ?? data;
    const vars = a.relationships?.variables?.data ?? [];
    return {
        id: a.id,
        nestId: a.nest_id,
        name: a.name,
        dockerImages: a.docker_images ?? [],
        startup: a.startup ?? '',
        variables: vars.map((row: any) => {
            const v = row.attributes ?? row;
            return {
                envVariable: v.env_variable,
                name: v.name,
                defaultValue: v.default_value ?? '',
                rules: v.rules ?? null,
            };
        }),
    };
}

// The first docker image string, regardless of map/array shape.
export function firstDockerImage(images: Record<string, string> | string[]): string {
    if (Array.isArray(images)) return images[0] ?? '';
    return Object.values(images)[0] ?? '';
}

export interface DockerImageOption {
    label: string;
    value: string;
}

// Egg docker images as { label, value } options. Eggs store images as a map of
// display-name → image (e.g. "Java 17" → "ghcr.io/.../java17"); older eggs may
// store a bare array, in which case the image string is its own label.
export function dockerImageOptions(images: Record<string, string> | string[]): DockerImageOption[] {
    if (Array.isArray(images)) return images.map(i => ({ label: i, value: i }));
    return Object.entries(images).map(([label, value]) => ({ label, value }));
}

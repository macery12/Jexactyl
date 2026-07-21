import http from '@/lib/http';
import type { ThemeColorKey, ThemeColors } from '@/lib/theme';

// Client for the admin theme API (/api/application/theme). Session-authed,
// same-origin, gated by the SETTINGS_UPDATE admin permission on the backend.

export interface ThemePreset {
    id: number;
    name: string;
    colors: Partial<ThemeColors>;
    is_builtin: boolean;
}

// Persist a single color key (e.g. 'primary', 'surface'). Maps to the backend
// `theme::colors:<key>` setting.
export async function updateColor(key: ThemeColorKey, value: string): Promise<void> {
    await http.put('/api/application/theme/colors', { key: `colors:${key}`, value });
}

// Persist a single feel/texture key (e.g. 'grid_enabled', 'grid_opacity').
export async function updateFeel(key: string, value: string | number | boolean): Promise<void> {
    await http.put('/api/application/theme/colors', { key: `feel:${key}`, value: String(value) });
}

// Reset every theme override back to the module defaults (M12Labs Blue).
export async function resetTheme(): Promise<void> {
    await http.post('/api/application/theme/reset');
}

export async function getPresets(): Promise<ThemePreset[]> {
    const { data } = await http.get('/api/application/theme/presets');
    return (data?.presets ?? []) as ThemePreset[];
}

export async function applyPreset(id: number): Promise<Partial<ThemeColors>> {
    const { data } = await http.post(`/api/application/theme/presets/${id}/apply`);
    return (data?.colors ?? {}) as Partial<ThemeColors>;
}

export async function savePreset(name: string): Promise<ThemePreset> {
    const { data } = await http.post('/api/application/theme/presets', { name });
    return data.preset as ThemePreset;
}

export async function deletePreset(id: number): Promise<void> {
    await http.delete(`/api/application/theme/presets/${id}`);
}

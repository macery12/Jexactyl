import http from '@/lib/http';

// Admin general/mode settings client. Mirrors V1's api/routes/admin/settings.ts
// contract — the `/api/application/settings` endpoints already exist server-side
// (GeneralController + ModeController), this is a frontend-only port. The
// backend stores each value under the `settings::app:*` key and bridges it onto
// `config('app.*')`, which is what `window.SiteConfiguration` is composed from.

export type PanelMode = 'standard' | 'personal';

export interface GeneralSettings {
    name: string;
    logo: string | null;
    locale: string;
    indicators: boolean;
    speed_dial: boolean;
}

// PATCH the general settings. Only the `app:*`-prefixed keys the backend
// validates are sent; everything is persisted in one request.
export async function updateGeneralSettings(values: GeneralSettings): Promise<void> {
    await http.patch('/api/application/settings', {
        'app:name': values.name,
        'app:logo': values.logo || null,
        'app:locale': values.locale,
        'app:indicators': values.indicators,
        'app:speed_dial': values.speed_dial,
    });
}

// PATCH the active panel mode (standard | personal). Debug mode is env-driven
// and intentionally not settable here.
export async function updateModeSettings(mode: PanelMode): Promise<void> {
    await http.patch('/api/application/settings/mode', { mode });
}

import http from '@/lib/http';
import type { LandingConfiguration } from '@/lib/globals';

// Admin client for the landing page configuration (/api/application/landing).
// Session-authed, gated by the SETTINGS_UPDATE admin permission server-side.

export async function getLandingConfig(): Promise<LandingConfiguration> {
    const { data } = await http.get<LandingConfiguration>('/api/application/landing');
    return data;
}

export async function updateLandingConfig(config: LandingConfiguration): Promise<void> {
    await http.patch('/api/application/landing', {
        enabled: config.enabled,
        sections: config.sections,
    });
}

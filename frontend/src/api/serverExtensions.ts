import http from '@/lib/http';

// Per-server extension list. Mirrors V1's api/server/extensions/index.ts against
// the existing /api/client/servers/{uuid}/extensions endpoint.
//
// Name, description, and icon come from the extension's manifest and are
// rendered verbatim — third-party manifest copy is intentionally NOT routed
// through the i18n catalog (same rule as the admin extensions pages).
export interface ServerExtension {
    id: string;
    name: string;
    description: string;
    icon: string;
    version: string;
    route: string;
    settings: Record<string, unknown>;
}

export async function getServerExtensions(uuid: string): Promise<ServerExtension[]> {
    const { data } = await http.get(`/api/client/servers/${uuid}/extensions`);
    return (data.data ?? []).map((e: any) => ({
        id: e.id,
        name: e.name,
        description: e.description ?? '',
        icon: e.icon ?? 'puzzle',
        version: e.version ?? '1.0.0',
        route: e.route || e.id,
        settings: e.settings ?? {},
    }));
}

/** Whether a given extension is enabled for this server — used by package pages to self-gate. */
export async function checkExtensionEnabled(uuid: string, extensionId: string): Promise<boolean> {
    const { data } = await http.get(`/api/client/servers/${uuid}/extensions/${extensionId}`);
    return Boolean(data.enabled);
}

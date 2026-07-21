import http from '@/lib/http';

// Client server-settings endpoints (/api/client/servers/{uuid}/settings + /deletion),
// ported from V1's routes/server/{index,deletion}.ts. Covers rename, reinstall,
// and the billing-linked deletion schedule.

export async function renameServer(uuid: string, name: string, description?: string): Promise<void> {
    await http.post(`/api/client/servers/${uuid}/settings/rename`, { name, description });
}

export async function reinstallServer(uuid: string): Promise<void> {
    await http.post(`/api/client/servers/${uuid}/settings/reinstall`);
}

export async function scheduleDeletion(uuid: string): Promise<void> {
    await http.post(`/api/client/servers/${uuid}/deletion/schedule`);
}

export async function cancelDeletion(uuid: string): Promise<void> {
    await http.post(`/api/client/servers/${uuid}/deletion/cancel`);
}

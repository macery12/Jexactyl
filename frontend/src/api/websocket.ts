import http from '@/lib/http';

// GET /api/client/servers/{id}/websocket → daemon socket URL + short-lived JWT.
export async function getWebsocketCredentials(id: string): Promise<{ token: string; socket: string }> {
    const { data } = await http.get(`/api/client/servers/${id}/websocket`);
    return { token: data.data.token, socket: data.data.socket };
}

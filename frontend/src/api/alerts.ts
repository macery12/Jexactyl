import http from '@/lib/http';

export interface Alert {
    id: number;
    title: string | null;
    content: string;
    type: 'success' | 'info' | 'warning' | 'danger';
}

// GET /api/client/alerts — admin-published announcements (raw model array).
// scope=dashboard returns dashboard-scoped + global alerts.
export async function getAlerts(): Promise<Alert[]> {
    const { data } = await http.get('/api/client/alerts', { params: { scope: 'dashboard' } });
    return (Array.isArray(data) ? data : []).map((a: Alert) => ({
        id: a.id,
        title: a.title ?? null,
        content: a.content,
        type: a.type,
    }));
}

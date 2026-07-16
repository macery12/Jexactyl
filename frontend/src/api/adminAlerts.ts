import http from '@/lib/http';

// Admin-side alerts module (Application API). Mirrors V1's
// `resources/scripts/api/routes/admin/alerts.ts` — broadcast announcements /
// banners shown to users. No backend changes: reuses the existing
// `/api/application/alerts` surface.

export type AlertType = 'success' | 'info' | 'warning' | 'danger';
export type AlertPosition = 'notification' | 'top-center' | 'slide-out' | 'center';
export type AlertScope = 'global' | 'dashboard' | 'server' | 'billing' | 'account' | 'admin';
export type UserTargeting = 'all' | 'specific';

export interface AlertUser {
    id: number;
    email: string;
    username: string;
}

export interface Alert {
    id: number;
    title: string | null;
    content: string;
    type: AlertType;
    position: AlertPosition;
    scope: AlertScope;
    user_targeting: UserTargeting;
    enabled: boolean;
    dismissible: boolean;
    show_button: boolean;
    button_text: string | null;
    link: string | null;
    link_text: string | null;
    priority: number;
    start_at: string | null;
    end_at: string | null;
    created_at: string;
    updated_at: string;
    users?: AlertUser[];
}

export interface AlertPayload {
    title?: string;
    content: string;
    type: AlertType;
    position: AlertPosition;
    scope: AlertScope;
    user_targeting: UserTargeting;
    user_ids?: number[];
    enabled?: boolean;
    dismissible?: boolean;
    link?: string;
    link_text?: string;
    priority?: number;
    start_at?: string;
    end_at?: string;
}

export async function getAlerts(): Promise<Alert[]> {
    const { data } = await http.get('/api/application/alerts');
    return Array.isArray(data) ? data : [];
}

export async function createAlert(payload: AlertPayload): Promise<Alert> {
    const { data } = await http.post('/api/application/alerts', payload);
    return data;
}

export async function updateAlert(id: number, payload: AlertPayload): Promise<Alert> {
    const { data } = await http.patch(`/api/application/alerts/${id}`, payload);
    return data;
}

export async function deleteAlert(id: number): Promise<void> {
    await http.delete(`/api/application/alerts/${id}`);
}

export async function searchAlertUsers(query: string): Promise<AlertUser[]> {
    const { data } = await http.get('/api/application/alerts/users/search', {
        params: { q: query, limit: 20 },
    });
    return Array.isArray(data) ? data : [];
}

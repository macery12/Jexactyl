import http from '@/api/http';
import { AlertPosition, AlertType } from '@/state/everest';

export type AlertScope = 'global' | 'dashboard' | 'server' | 'billing' | 'account' | 'admin';
export type ButtonPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
export type UserTargeting = 'all' | 'specific';

export interface AlertUser {
    id: number;
    email: string;
    username: string;
}

export interface Alert {
    id: number;
    title?: string;
    content: string;
    type: AlertType;
    position: AlertPosition;
    scope: AlertScope;
    user_targeting: UserTargeting;
    enabled: boolean;
    dismissible: boolean;
    show_button: boolean;
    button_text?: string;
    button_position: ButtonPosition;
    link?: string;
    link_text?: string;
    priority: number;
    start_at?: string;
    end_at?: string;
    created_at: string;
    updated_at: string;
    users?: AlertUser[];
}

export interface CreateAlertData {
    title?: string;
    content: string;
    type: AlertType;
    position: AlertPosition;
    scope: AlertScope;
    user_targeting: UserTargeting;
    user_ids?: number[];
    enabled?: boolean;
    dismissible?: boolean;
    show_button?: boolean;
    button_text?: string;
    button_position?: ButtonPosition;
    link?: string;
    link_text?: string;
    priority?: number;
    start_at?: string;
    end_at?: string;
}

export interface UpdateAlertData {
    title?: string;
    content?: string;
    type?: AlertType;
    position?: AlertPosition;
    scope?: AlertScope;
    user_targeting?: UserTargeting;
    user_ids?: number[];
    enabled?: boolean;
    dismissible?: boolean;
    show_button?: boolean;
    button_text?: string;
    button_position?: ButtonPosition;
    link?: string;
    link_text?: string;
    priority?: number;
    start_at?: string;
    end_at?: string;
}

export const getAlerts = async (): Promise<Alert[]> => {
    const { data } = await http.get('/api/application/alerts');
    return data;
};

export const createAlert = async (alertData: CreateAlertData): Promise<Alert> => {
    const { data } = await http.post('/api/application/alerts', alertData);
    return data;
};

export const updateAlert = async (id: number, alertData: UpdateAlertData): Promise<Alert> => {
    const { data } = await http.patch(`/api/application/alerts/${id}`, alertData);
    return data;
};

export const deleteAlert = async (id: number): Promise<void> => {
    await http.delete(`/api/application/alerts/${id}`);
};

export const searchUsers = async (query: string): Promise<AlertUser[]> => {
    const { data } = await http.get('/api/application/alerts/users/search', {
        params: { q: query, limit: 20 },
    });
    return data;
};

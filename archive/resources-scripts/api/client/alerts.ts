import http from '@/api/http';

export interface ActiveAlert {
    id: number;
    title?: string;
    content: string;
    type: 'success' | 'info' | 'warning' | 'danger';
    position: 'top-center' | 'slide-out' | 'top-right-banner' | 'center';
    scope: 'global' | 'dashboard' | 'server' | 'billing' | 'account' | 'admin';
    enabled: boolean;
    dismissible: boolean;
    show_button: boolean;
    button_text?: string;
    button_position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
    link?: string;
    link_text?: string;
    priority: number;
    start_at?: string;
    end_at?: string;
    created_at: string;
    updated_at: string;
}

type AlertScope = 'global' | 'dashboard' | 'server' | 'billing' | 'account' | 'admin' | 'all';

let alertCache: Promise<ActiveAlert[]> | null = null;

const fetchAllAlerts = (): Promise<ActiveAlert[]> => {
    if (!alertCache) {
        alertCache = http
            .get('/api/client/alerts', { params: { scope: 'all' } })
            .then(r => r.data)
            .catch(() => {
                alertCache = null;
                return [];
            });
    }
    return alertCache;
};

export const getActiveAlerts = async (scope: AlertScope = 'global'): Promise<ActiveAlert[]> => {
    const all = await fetchAllAlerts();
    if (scope === 'all') return all;
    return all.filter(a => a.scope === scope || a.scope === 'global');
};

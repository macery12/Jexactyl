import http from '@/api/http';
import { AccountSession, Transformers } from '@definitions/account';

const getAccountSessions = (): Promise<AccountSession[]> => {
    return new Promise((resolve, reject) => {
        http.get('/api/client/account/sessions')
            .then(({ data }) => resolve((data.data || []).map(Transformers.toAccountSession)))
            .catch(reject);
    });
};

const getAccountSessionHistory = (): Promise<AccountSession[]> => {
    return new Promise((resolve, reject) => {
        http.get('/api/client/account/sessions/history')
            .then(({ data }) => resolve((data.data || []).map(Transformers.toAccountSession)))
            .catch(reject);
    });
};

const revokeAccountSession = (id: number): Promise<void> => {
    return new Promise((resolve, reject) => {
        http.post(`/api/client/account/sessions/${id}/revoke`)
            .then(() => resolve())
            .catch(reject);
    });
};

const revokeAllAccountSessions = (includeCurrent = false): Promise<void> => {
    return new Promise((resolve, reject) => {
        http.post('/api/client/account/sessions/revoke-all', { include_current: includeCurrent })
            .then(() => resolve())
            .catch(reject);
    });
};

const labelAccountSession = (id: number, label: string | null): Promise<void> => {
    return new Promise((resolve, reject) => {
        http.patch(`/api/client/account/sessions/${id}/label`, { label })
            .then(() => resolve())
            .catch(reject);
    });
};

export { getAccountSessions, getAccountSessionHistory, revokeAccountSession, revokeAllAccountSessions, labelAccountSession };

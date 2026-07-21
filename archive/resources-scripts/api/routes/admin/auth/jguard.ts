import http from '@/api/http';

export interface JGuardPendingUser {
    id: number;
    user_id: number;
    username: string;
    email: string;
    status: 'pending' | 'approved' | 'rejected';
    approval_mode: 'manual' | 'delayed';
    expires_at: string | null;
    created_at: string;
}

export const getJGuardPending = (status = 'pending'): Promise<JGuardPendingUser[]> => {
    return http.get('/api/application/auth/jguard/pending', { params: { status } }).then(({ data }) => data.data);
};

export const approveJGuardUser = (userId: number): Promise<void> => {
    return http.post(`/api/application/auth/jguard/approve/${userId}`).then(() => undefined);
};

export const rejectJGuardUser = (userId: number): Promise<void> => {
    return http.post(`/api/application/auth/jguard/reject/${userId}`).then(() => undefined);
};

export interface JGuardSettingsValues {
    approval_mode?: 'manual' | 'delayed';
    delay?: number;
    pending_message?: string;
}

export const updateJGuardSettings = (values: JGuardSettingsValues): Promise<void> => {
    return http.patch('/api/application/auth/jguard/settings', values).then(() => undefined);
};

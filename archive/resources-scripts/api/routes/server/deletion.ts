import http from '@/api/http';

export const scheduleDeletion = (serverUuid: string): Promise<void> => {
    return http.post(`/api/client/servers/${serverUuid}/deletion/schedule`).then(() => undefined);
};

export const cancelDeletion = (serverUuid: string): Promise<void> => {
    return http.post(`/api/client/servers/${serverUuid}/deletion/cancel`).then(() => undefined);
};

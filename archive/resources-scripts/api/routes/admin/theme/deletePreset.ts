import http from '@/api/http';

export default (id: number): Promise<void> => {
    return http.delete(`/api/application/theme/presets/${id}`).then(() => undefined);
};

import http from '@/api/http';
import { SiteTheme } from '@/state/theme';

export default (id: number): Promise<SiteTheme['colors']> => {
    return http.post(`/api/application/theme/presets/${id}/apply`).then(({ data }) => data.colors);
};

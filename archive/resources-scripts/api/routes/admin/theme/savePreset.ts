import http from '@/api/http';
import { ThemePreset } from './getPresets';

export default (name: string): Promise<ThemePreset> => {
    return http.post('/api/application/theme/presets', { name }).then(({ data }) => data.preset);
};

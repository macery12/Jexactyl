import http from '@/api/http';

export interface ThemePreset {
    id: number;
    name: string;
    colors: {
        primary: string;
        secondary: string;
        background: string;
        headers: string;
        sidebar: string;
    };
    is_builtin: boolean;
}

export default (): Promise<ThemePreset[]> => {
    return http.get('/api/application/theme/presets').then(({ data }) => data.presets);
};

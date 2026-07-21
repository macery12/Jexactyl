import http from '@/api/http';
import { PanelMode } from '@/state/settings';

export interface GeneralSettings {
    name: string;
    logo: URL | null;
    indicators: boolean;
    speed_dial: boolean;
}

export const updateGeneralSettings = async (settings: Partial<GeneralSettings>): Promise<void> => {
    return new Promise((resolve, reject) => {
        http.patch(`/api/application/settings`, {
            'app:name': settings.name,
            'app:logo': settings.logo,
            'app:indicators': settings.indicators,
            'app:speed_dial': settings.speed_dial,
        })
            .then(() => resolve())
            .catch(reject);
    });
};

export const updateModeSettings = async (mode: PanelMode): Promise<void> => {
    return new Promise((resolve, reject) => {
        http.patch(`/api/application/settings/mode`, mode)
            .then(() => resolve())
            .catch(reject);
    });
};

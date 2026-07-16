import { action, Action } from 'easy-peasy';

export type PanelMode = 'standard' | 'personal' | undefined;

export interface SiteSettings {
    name: string;
    logo: URL | null;
    mode: PanelMode;
    debug: boolean;
    locale: string;
    indicators: boolean;
    speed_dial: boolean;
    setup: boolean;
    captcha: {
        enabled: boolean;
        siteKey: string;
    };
    activity: {
        enabled: {
            account: boolean;
            server: boolean;
            admin: boolean;
        };
    };
    translations?: {
        activity?: Record<string, string>;
        [key: string]: Record<string, string> | undefined;
    };
}

export interface SettingsStore {
    data?: SiteSettings;
    setSettings: Action<SettingsStore, SiteSettings>;
    updateSettings: Action<SettingsStore, Partial<SiteSettings>>;
}

const settings: SettingsStore = {
    data: undefined,

    setSettings: action((state, payload) => {
        state.data = payload;
    }),

    updateSettings: action((state, payload) => {
        // @ts-expect-error limitation of Typescript, can't do much about that currently unfortunately.
        state.data = { ...state.data, ...payload };
    }),
};

export default settings;

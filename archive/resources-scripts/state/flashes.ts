import { Action, action } from 'easy-peasy';
import { FlashMessageType } from '@/elements/MessageBox';
import { httpErrorToHuman } from '@/api/http';

export interface FlashStore {
    items: FlashMessage[];
    addFlash: Action<FlashStore, FlashMessage>;
    addError: Action<FlashStore, { message: string; key?: string }>;
    clearAndAddHttpError: Action<FlashStore, { error?: Error | any | null; key?: string }>;
    clearFlashes: Action<FlashStore, string | void>;
    removeFlash: Action<FlashStore, string>;
}

export interface FlashMessage {
    id?: string;
    key?: string;
    type: FlashMessageType;
    title?: string;
    message: string;
}

const flashes: FlashStore = {
    items: [],

    addFlash: action((state, payload) => {
        const id =
            payload.id ??
            (typeof crypto !== 'undefined' && 'randomUUID' in crypto
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`);
        state.items.push({ ...payload, id });
    }),

    addError: action((state, payload) => {
        state.items.push({ type: 'error', title: 'Error', ...payload });
    }),

    clearAndAddHttpError: action((state, payload) => {
        if (!payload.error) {
            state.items = [];
        } else {
            console.error(payload.error);

            state.items = [
                {
                    type: 'error',
                    title: 'Error',
                    key: payload.key,
                    message: httpErrorToHuman(payload.error),
                },
            ];
        }
    }),

    clearFlashes: action((state, payload) => {
        state.items = payload ? state.items.filter(flashes => flashes.key !== payload) : [];
    }),

    removeFlash: action((state, id) => {
        state.items = state.items.filter(flash => flash.id !== id);
    }),
};

export default flashes;

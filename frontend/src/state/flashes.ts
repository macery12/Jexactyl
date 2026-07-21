import { create } from 'zustand';
import type { FlashMessage } from '@/lib/globals';

let nextId = 0;

export interface Flash extends FlashMessage {
    id: number;
}

interface FlashState {
    flashes: Flash[];
    push: (flash: FlashMessage) => void;
    dismiss: (id: number) => void;
    clear: () => void;
}

export const useFlashes = create<FlashState>(set => ({
    flashes: [],
    push: flash => set(state => ({ flashes: [...state.flashes, { ...flash, id: nextId++ }] })),
    dismiss: id => set(state => ({ flashes: state.flashes.filter(f => f.id !== id) })),
    clear: () => set({ flashes: [] }),
}));

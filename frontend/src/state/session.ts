import { create } from 'zustand';
import type { PterodactylUser } from '@/lib/globals';

interface SessionState {
    user: PterodactylUser | null;
    isAuthenticated: boolean;
    setUser: (user: PterodactylUser | null) => void;
}

export const useSession = create<SessionState>(set => ({
    user: null,
    isAuthenticated: false,
    setUser: user => set({ user, isAuthenticated: user !== null }),
}));

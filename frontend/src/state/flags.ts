import { create } from 'zustand';
import type { EverestConfiguration, SiteConfiguration, LandingConfiguration } from '@/lib/globals';

interface FlagsState {
    everest: EverestConfiguration | null;
    site: SiteConfiguration | null;
    landing: LandingConfiguration | null;
    set: (everest: EverestConfiguration | null, site: SiteConfiguration | null) => void;
    setLanding: (landing: LandingConfiguration | null) => void;
}

export const useFlags = create<FlagsState>(set => ({
    everest: null,
    site: null,
    landing: null,
    set: (everest, site) => set({ everest, site }),
    setLanding: landing => set({ landing }),
}));

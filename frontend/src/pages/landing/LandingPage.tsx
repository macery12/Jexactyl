import { useFlags } from '@/state/flags';
import type { LandingSection } from '@/lib/globals';
import LandingCanvas from './LandingCanvas';

// Built-in fallback used when no landing config was injected (e.g. composer
// failed). Mirrors the original hero + features layout.
const DEFAULT_SECTIONS: LandingSection[] = [
    { id: 'hero', enabled: true, order: 0, data: {} },
    { id: 'features', enabled: true, order: 1, data: {} },
];

export default function LandingPage() {
    const site = useFlags(s => s.site);
    const landing = useFlags(s => s.landing);
    const name = site?.name ?? 'M12Labs';

    const sections = landing && landing.enabled ? landing.sections : DEFAULT_SECTIONS;

    return <LandingCanvas sections={sections} name={name} />;
}

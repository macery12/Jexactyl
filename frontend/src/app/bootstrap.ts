import { useSession } from '@/state/session';
import { useFlags } from '@/state/flags';
import { useFlashes } from '@/state/flashes';
import { applyThemeVars, normalizeTheme } from '@/lib/theme';
import { takePendingFlash } from '@/lib/pendingFlash';

// Read the Blade→JS handoff (window.* globals) into the client stores. This is
// the Phase 1 bootstrap; a future /api/client/me endpoint can replace it.
export function bootstrap(): void {
    useSession.getState().setUser(window.PterodactylUser ?? null);
    useFlags.getState().set(window.EverestConfiguration ?? null, window.SiteConfiguration ?? null);
    useFlags.getState().setLanding(window.LandingConfiguration ?? null);

    if (Array.isArray(window.FlashMessages)) {
        for (const flash of window.FlashMessages) useFlashes.getState().push(flash);
    }

    // Replay a flash stashed just before a locale-change reload (see LanguageCard
    // / admin settings), so the "saved" confirmation survives the reboot.
    const pending = takePendingFlash();
    if (pending) useFlashes.getState().push(pending);

    // Apply the runtime theme (brand + base + status + feel) onto <html>'s CSS
    // vars, deriving hover/soft/faint shades. Missing fields fall back to the
    // M12Labs Blue defaults.
    applyThemeVars(normalizeTheme(window.ThemeConfiguration));
}

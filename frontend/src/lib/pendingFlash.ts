import type { FlashMessage } from '@/lib/globals';

// A one-shot flash that survives a full page reload. Some actions (changing the
// panel language) reload the page to re-boot Paraglide cleanly in the new
// locale; stashing the success message here lets bootstrap replay it once the
// fresh page comes up, so the confirmation isn't lost to the reload.
const KEY = 'm12:pendingFlash';

export function stashFlash(flash: FlashMessage): void {
    try {
        sessionStorage.setItem(KEY, JSON.stringify(flash));
    } catch {
        // sessionStorage unavailable (private mode / disabled) — the reload
        // still switches the language, which is confirmation enough.
    }
}

export function takePendingFlash(): FlashMessage | null {
    try {
        const raw = sessionStorage.getItem(KEY);
        if (!raw) return null;
        sessionStorage.removeItem(KEY);
        return JSON.parse(raw) as FlashMessage;
    } catch {
        return null;
    }
}

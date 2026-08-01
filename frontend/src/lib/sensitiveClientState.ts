const CHECKOUT_DRAFT_PREFIX = 'v2:checkout:draft:';
const CONSOLE_HISTORY_SUFFIX = ':command_history';

/**
 * Remove browser-persisted secrets written by older frontend builds.
 *
 * Current checkout variables and console commands are memory-only. This
 * cleanup intentionally leaves unrelated UI preferences and flashes intact.
 */
export function clearLegacySensitiveClientStorage(): void {
    if (typeof window === 'undefined') return;

    try {
        removeMatchingStorageKeys(
            window.sessionStorage,
            key => key.startsWith(CHECKOUT_DRAFT_PREFIX) || key.startsWith('checkout_draft_'),
        );
    } catch {
        // Accessing the Storage object itself can throw under browser policy.
    }

    try {
        removeMatchingStorageKeys(
            window.localStorage,
            key => key.endsWith(CONSOLE_HISTORY_SUFFIX),
        );
    } catch {
        // Accessing the Storage object itself can throw under browser policy.
    }
}

function removeMatchingStorageKeys(storage: Storage, matches: (key: string) => boolean): void {
    try {
        const keys: string[] = [];
        for (let index = 0; index < storage.length; index += 1) {
            const key = storage.key(index);
            if (key && matches(key)) keys.push(key);
        }
        keys.forEach(key => storage.removeItem(key));
    } catch {
        // Storage can be unavailable in private or policy-restricted contexts.
    }
}

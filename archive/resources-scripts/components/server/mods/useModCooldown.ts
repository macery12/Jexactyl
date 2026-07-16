import { useCallback, useEffect, useState } from 'react';

const COOLDOWN_MS = 5000;

// Module-level state shared across all button instances — key is modId (string).
const timers    = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Map<string, Set<(active: boolean) => void>>();

function notify(modId: string, active: boolean) {
    listeners.get(modId)?.forEach(fn => fn(active));
}

/**
 * Returns [isOnCooldown, startCooldown].
 * All buttons with the same modId share the same cooldown state — clicking any
 * version download for a mod blocks all version buttons for that mod for 5s.
 */
export function useModCooldown(modId: string | number): [boolean, () => void] {
    const key = String(modId);
    const [onCooldown, setOnCooldown] = useState(() => timers.has(key));

    useEffect(() => {
        if (!listeners.has(key)) listeners.set(key, new Set());
        const set = listeners.get(key)!;
        set.add(setOnCooldown);
        return () => { set.delete(setOnCooldown); };
    }, [key]);

    const startCooldown = useCallback(() => {
        if (timers.has(key)) clearTimeout(timers.get(key)!);
        notify(key, true);
        const t = setTimeout(() => {
            timers.delete(key);
            notify(key, false);
        }, COOLDOWN_MS);
        timers.set(key, t);
    }, [key]);

    return [onCooldown, startCooldown];
}

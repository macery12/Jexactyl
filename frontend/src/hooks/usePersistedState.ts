import { useCallback, useState } from 'react';

// Tiny localStorage-backed state, mirroring V1's usePersistedState used by the
// console command history. JSON-serialised; falls back to `initial` on any error.
export function usePersistedState<T>(key: string, initial: T): [T, (value: T | ((prev: T) => T)) => void] {
    const [state, setState] = useState<T>(() => {
        try {
            const raw = localStorage.getItem(key);
            return raw !== null ? (JSON.parse(raw) as T) : initial;
        } catch {
            return initial;
        }
    });

    const set = useCallback(
        (value: T | ((prev: T) => T)) => {
            setState(prev => {
                const next = typeof value === 'function' ? (value as (p: T) => T)(prev) : value;
                try {
                    localStorage.setItem(key, JSON.stringify(next));
                } catch {
                    /* ignore quota / private-mode errors */
                }
                return next;
            });
        },
        [key],
    );

    return [state, set];
}

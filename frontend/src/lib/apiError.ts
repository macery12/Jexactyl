import { isAxiosError } from 'axios';

// Pull the first human-readable message out of a Fractal/Laravel error response.
// Fractal validation errors arrive as `{ errors: [{ detail }] }`; other failures
// fall back to a top-level `message`. Returns undefined when nothing usable is
// present so callers can substitute their own localized fallback.
export function firstError(err: unknown): string | undefined {
    if (isAxiosError(err)) {
        const errors = err.response?.data?.errors;
        if (Array.isArray(errors) && errors[0]?.detail) return errors[0].detail;
        return err.response?.data?.message;
    }
    return undefined;
}

/**
 * The machine-readable `code` on a Fractal error — the backend puts the
 * exception's class basename there (`AccountPendingApprovalException`, …).
 * Use it to branch on a specific failure instead of matching message text,
 * which is localized and admin-configurable.
 */
export function errorCode(err: unknown): string | undefined {
    if (!isAxiosError(err)) return undefined;
    const errors = err.response?.data?.errors;
    return Array.isArray(errors) ? errors[0]?.code : undefined;
}

interface FractalValidationError {
    detail?: string;
    meta?: { source_field?: string; rule?: string };
}

/**
 * Map a 422's per-field messages onto a react-hook-form instance so they render
 * next to the offending input instead of only as a toast. Laravel's validator
 * reports the field in `meta.source_field`, already dotted for nested rules
 * (`limits.io`), which is exactly RHF's path syntax.
 *
 * Returns true when at least one error was attached — callers can use that to
 * skip the generic toast, since the form is now self-explanatory.
 */
export function applyFieldErrors(
    err: unknown,
    setError: (name: never, error: { type: string; message: string }) => void,
): boolean {
    if (!isAxiosError(err) || err.response?.status !== 422) return false;
    const errors = err.response?.data?.errors;
    if (!Array.isArray(errors)) return false;

    let attached = false;
    for (const e of errors as FractalValidationError[]) {
        const field = e.meta?.source_field;
        if (!field || !e.detail) continue;
        setError(field as never, { type: 'server', message: e.detail });
        attached = true;
    }
    return attached;
}

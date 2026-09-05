import { isAxiosError } from 'axios';
import { m } from '@/i18n/messages';

/**
 * Machine-readable codes the panel carries its own translation for. The backend
 * emits these with hardcoded English text — EmailVerificationGate::ERROR_MESSAGE
 * is a PHP constant, not a translation key — so a `ru` panel would otherwise
 * show English. Anything absent here falls through to the server's own string,
 * which for DisplayException/validation failures is already the better copy.
 */
const LOCALIZED_CODES: Record<string, () => string> = {
    EMAIL_NOT_VERIFIED: () => m['common.error.emailNotVerified'](),
};

// Pull the first human-readable message out of a Fractal/Laravel error response.
// Fractal validation errors arrive as `{ errors: [{ detail }] }`; other failures
// fall back to a top-level `message`. Returns undefined when nothing usable is
// present so callers can substitute their own localized fallback.
export function firstError(err: unknown): string | undefined {
    if (isAxiosError(err)) {
        const localized = LOCALIZED_CODES[errorCode(err) ?? ''];
        if (localized) return localized();

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
 *
 * A few gates answer outside the Fractal envelope with a flat
 * `{ code, message }` body (EmailVerificationGate's `EMAIL_NOT_VERIFIED`, for
 * one), so fall back to the top-level `code` before giving up.
 */
export function errorCode(err: unknown): string | undefined {
    if (!isAxiosError(err)) return undefined;
    const data = err.response?.data;
    const errors = data?.errors;
    if (Array.isArray(errors) && errors[0]?.code) return errors[0].code;
    return typeof data?.code === 'string' ? data.code : undefined;
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

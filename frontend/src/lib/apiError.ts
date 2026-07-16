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

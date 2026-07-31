import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { abs } from '@/lib/base';
import { readCsrfToken } from '@/lib/globals';

// Shared axios instance. Mirrors V1's api/http.ts contract: same-origin cookie
// auth, CSRF token on every mutating request, and the JSON:API accept header.
// Tokens never touch localStorage.
const http = axios.create({
    withCredentials: true,
    headers: {
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json',
        'Content-Type': 'application/json',
    },
});

// Laravel sets XSRF-TOKEN on every response and rotates it whenever the session
// is regenerated. The <meta> tag, by contrast, is a snapshot of whatever the
// session held when the document was served — so a tab that outlives its session
// sends a dead token forever and every mutation 419s, including the login POST
// that would have recovered it. Prefer the cookie; fall back to the meta tag only
// on the very first request of a fresh document.
function readXsrfCookie(): string {
    const raw = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/)?.[1];
    if (!raw) return '';
    try {
        return decodeURIComponent(raw);
    } catch {
        return '';
    }
}

http.interceptors.request.use(config => {
    const method = (config.method ?? 'get').toLowerCase();
    if (method !== 'get' && method !== 'head') {
        const cookieToken = readXsrfCookie();
        if (cookieToken) {
            // Laravel decrypts X-XSRF-TOKEN, whereas X-CSRF-TOKEN is compared raw.
            // The cookie is the encrypted form, so it must go on the former header.
            config.headers.set('X-XSRF-TOKEN', cookieToken);
        } else {
            config.headers.set('X-CSRF-TOKEN', readCsrfToken());
        }
    }
    return config;
});

// Laravel Sanctum CSRF priming — call before the first mutating auth request.
export const primeCsrf = (): Promise<unknown> => http.get('/sanctum/csrf-cookie');

/** Marks a request we have already replayed, so a retry loop cannot form. */
type RetriedConfig = InternalAxiosRequestConfig & { __csrfRetried?: boolean };

/** Auth pages must not redirect to themselves on an expected 401. */
function onAuthPage(): boolean {
    return window.location.pathname.startsWith(abs('/auth'));
}

http.interceptors.response.use(
    response => response,
    async (error: AxiosError) => {
        const status = error.response?.status;
        const config = error.config as RetriedConfig | undefined;

        // 419 is a CSRF token mismatch — almost always a stale token rather than a
        // genuine forgery. Re-prime to pick up a fresh XSRF-TOKEN cookie and replay
        // the request exactly once.
        if (status === 419 && config && !config.__csrfRetried) {
            config.__csrfRetried = true;
            try {
                await primeCsrf();
                return await http.request(config);
            } catch {
                // Still failing: the document itself is stale. A reload is the only
                // reliable recovery and it lands the user on a live token.
                window.location.reload();
                return await new Promise<never>(() => {});
            }
        }

        // 401 means the session is gone — expired, revoked from another device, or
        // signed out elsewhere. Without this the SPA kept rendering the dashboard
        // from its boot-time snapshot and only surfaced generic error toasts.
        if (status === 401 && !onAuthPage()) {
            // Hard navigation rather than a router push, so in-memory stores, query
            // caches and websockets are all torn down along with the document.
            window.location.assign(abs('/auth/login'));
            return await new Promise<never>(() => {});
        }

        return await Promise.reject(error);
    },
);

export default http;

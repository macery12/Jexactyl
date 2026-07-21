import axios from 'axios';
import { readCsrfToken } from '@/lib/globals';

// Shared axios instance. Mirrors V1's api/http.ts contract: same-origin cookie
// auth, CSRF token from the <meta> tag on every mutating request, and the
// JSON:API accept header. Tokens never touch localStorage.
const http = axios.create({
    withCredentials: true,
    headers: {
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json',
        'Content-Type': 'application/json',
    },
});

http.interceptors.request.use(config => {
    const method = (config.method ?? 'get').toLowerCase();
    if (method !== 'get' && method !== 'head') {
        config.headers.set('X-CSRF-TOKEN', readCsrfToken());
    }
    return config;
});

export default http;

// Laravel Sanctum CSRF priming — call before the first mutating auth request.
export const primeCsrf = (): Promise<unknown> => http.get('/sanctum/csrf-cookie');

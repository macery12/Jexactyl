import http from '@/api/http';
import { type PasswordResetResponse } from '@definitions/auth';

type PasswordResetMethod = 'email' | 'recovery_code';

const performPasswordReset = (
    email: string,
    data: { token: string; password: string; passwordConfirmation: string },
): Promise<PasswordResetResponse> => {
    return new Promise((resolve, reject) => {
        http.post('/auth/password/reset', {
            email,
            token: data.token,
            password: data.password,
            password_confirmation: data.passwordConfirmation,
        })
            .then(response =>
                resolve({
                    redirectTo: response.data.redirect_to,
                    sendToLogin: response.data.send_to_login,
                }),
            )
            .catch(reject);
    });
};

const requestPasswordReset = (
    email: string,
    code: string,
    password: string,
    password_confirm: string,
    captchaToken?: string,
): Promise<string> => {
    return new Promise((resolve, reject) => {
        http.post('/auth/password', {
            email,
            code,
            password,
            password_confirm,
            'cf-turnstile-response': captchaToken ?? '',
        })
            .then(response => resolve(response.data.status || ''))
            .catch(reject);
    });
};

const getPasswordResetMethod = (): Promise<PasswordResetMethod> => {
    return new Promise((resolve, reject) => {
        http.get('/auth/password-reset/method')
            .then(response => resolve(response.data.method))
            .catch(reject);
    });
};

const requestPasswordResetEmail = (email: string, captchaToken?: string): Promise<string> => {
    return new Promise((resolve, reject) => {
        http.post('/auth/password-reset/email', { email, 'cf-turnstile-response': captchaToken ?? '' })
            .then(response => resolve(response.data.message || 'If account exists, reset email sent'))
            .catch(reject);
    });
};

const resetPasswordWithToken = (
    email: string,
    data: { token: string; password: string; passwordConfirmation: string },
    captchaToken?: string,
): Promise<boolean> => {
    return new Promise((resolve, reject) => {
        http.post('/auth/password-reset/reset', {
            email,
            token: data.token,
            password: data.password,
            password_confirmation: data.passwordConfirmation,
            'cf-turnstile-response': captchaToken ?? '',
        })
            .then(response => resolve(Boolean(response.data.success)))
            .catch(reject);
    });
};

export {
    getPasswordResetMethod,
    performPasswordReset,
    requestPasswordReset,
    requestPasswordResetEmail,
    resetPasswordWithToken,
};

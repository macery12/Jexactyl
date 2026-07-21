import http from '@/api/http';
import { type AuthResponse } from '@definitions/auth';

export interface LoginData {
    username: string;
    email: string;
    password: string;
    password_confirmation: string;
}

export interface UsernameCheckResponse {
    available: boolean;
    message: string;
}

export const checkUsernameAvailability = (username: string): Promise<UsernameCheckResponse> => {
    return new Promise((resolve, reject) => {
        http.post('/auth/check-username', { username })
            .then(({ data }) => resolve(data))
            .catch(reject);
    });
};

export default ({
    username,
    email,
    password,
    password_confirmation,
    ...rest
}: LoginData & Record<string, any>): Promise<AuthResponse> => {
    return new Promise((resolve, reject) => {
        http.get('/sanctum/csrf-cookie')
            .then(() =>
                http.post('/auth/register', {
                    username,
                    email,
                    password,
                    password_confirmation,
                    ...rest,
                }),
            )
            .then(response => {
                if (!(response.data instanceof Object)) {
                    return reject(new Error('An error occurred while processing the registration request.'));
                }

                return resolve({
                    complete: response.data.data.complete,
                    intended: response.data.data.intended || undefined,
                    confirmationToken: response.data.data.confirmation_token || undefined,
                    userState: response.data.data.user?.state ?? null,
                });
            })
            .catch(reject);
    });
};

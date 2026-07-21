import http from '@/api/http';

export const sendEmailVerification = async (): Promise<void> => {
    await http.post('/api/client/account/email/verification');
};

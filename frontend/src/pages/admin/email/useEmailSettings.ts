import { m } from '@/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getEmailSettings, updateEmailSettings, type EmailSettingsUpdate } from '@/api/email';
import { useFlashes } from '@/state/flashes';
import { firstError } from '@/lib/apiError';

export const EMAIL_SETTINGS_KEY = ['admin', 'email', 'settings'] as const;

// Shared loader for the split settings pages (Overview / SMTP / Resend /
// Testing). The settings doc is fetched once and cached; each page edits its
// own slice and saves a partial update, then the cache is refreshed so the
// other pages see it. Errors surface as flashes.
export function useEmailSettings() {
    const qc = useQueryClient();
    const push = useFlashes(s => s.push);
    const query = useQuery({ queryKey: EMAIL_SETTINGS_KEY, queryFn: getEmailSettings });

    const mutation = useMutation({
        mutationFn: (update: EmailSettingsUpdate) => updateEmailSettings(update),
        onSuccess: data => qc.setQueryData(EMAIL_SETTINGS_KEY, data),
        onError: err => push({ type: 'error', message: firstError(err) ?? m['admin.email.settings.saveError']() }),
    });

    return {
        settings: query.data,
        isLoading: query.isLoading,
        isError: query.isError,
        save: mutation.mutateAsync,
        saving: mutation.isPending,
    };
}

import { useEffect, useState } from 'react';
import Input from '@/elements/Input';
import { Button } from '@/elements/button';
import SpinnerOverlay from '@/elements/SpinnerOverlay';
import useFlash from '@/plugins/useFlash';
import { useStoreState } from '@/state/hooks';
import {
    createCustomDomainApiKey,
    deleteCustomDomainApiKey,
    getCustomDomainSettings,
    getCustomDomainApiKeys,
    updateCustomDomainSettings,
    updateCustomDomainApiKey,
    type CustomDomainApiKey,
} from '@/api/routes/admin/customDomains';

export default () => {
    const { clearFlashes, clearAndAddHttpError, addFlash } = useFlash();
    const { colors } = useStoreState(state => state.theme.data!);

    const [loading, setLoading] = useState(false);
    const [apiKeys, setApiKeys] = useState<CustomDomainApiKey[]>([]);
    const [name, setName] = useState('');
    const [token, setToken] = useState('');
    const [rateLimitCreatePerMinute, setRateLimitCreatePerMinute] = useState(10);
    const [rateLimitSyncPerMinute, setRateLimitSyncPerMinute] = useState(5);
    const [rateLimitBillingOptionsPerMinute, setRateLimitBillingOptionsPerMinute] = useState(20);

    const loadApiKeys = async () => {
        const rows = await getCustomDomainApiKeys();
        setApiKeys(rows);
    };

    const loadSettings = async () => {
        const data = await getCustomDomainSettings();
        setRateLimitCreatePerMinute(Number(data.rate_limit_create_per_minute || 10));
        setRateLimitSyncPerMinute(Number(data.rate_limit_sync_per_minute || 5));
        setRateLimitBillingOptionsPerMinute(Number(data.rate_limit_billing_options_per_minute || 20));
    };

    useEffect(() => {
        clearFlashes('admin:custom-domains');
        setLoading(true);

        Promise.all([loadApiKeys(), loadSettings()])
            .catch(error => clearAndAddHttpError({ key: 'admin:custom-domains', error }))
            .finally(() => setLoading(false));
    }, []);

    const onSaveSecurityAndLimits = async () => {
        clearFlashes('admin:custom-domains');
        setLoading(true);

        try {
            await updateCustomDomainSettings({
                allow_wildcard: false,
                max_wildcards_per_user: 1,
                rate_limit_create_per_minute: rateLimitCreatePerMinute,
                rate_limit_sync_per_minute: rateLimitSyncPerMinute,
                rate_limit_billing_options_per_minute: rateLimitBillingOptionsPerMinute,
            });

            addFlash({
                key: 'admin:custom-domains',
                type: 'success',
                message: 'Security and rate limit settings saved.',
            });
        } catch (error) {
            clearAndAddHttpError({ key: 'admin:custom-domains', error });
        } finally {
            setLoading(false);
        }
    };

    const onCreate = async () => {
        clearFlashes('admin:custom-domains');
        setLoading(true);

        try {
            await createCustomDomainApiKey({ name: name.trim(), token: token.trim(), enabled: true });
            setName('');
            setToken('');
            await loadApiKeys();

            addFlash({
                key: 'admin:custom-domains',
                type: 'success',
                message: 'Cloudflare API key saved.',
            });
        } catch (error) {
            clearAndAddHttpError({ key: 'admin:custom-domains', error });
        } finally {
            setLoading(false);
        }
    };

    const onToggle = async (row: CustomDomainApiKey) => {
        clearFlashes('admin:custom-domains');
        setLoading(true);

        try {
            await updateCustomDomainApiKey(row.id, { enabled: !row.enabled });
            await loadApiKeys();
        } catch (error) {
            clearAndAddHttpError({ key: 'admin:custom-domains', error });
        } finally {
            setLoading(false);
        }
    };

    const onDelete = async (id: number) => {
        clearFlashes('admin:custom-domains');
        setLoading(true);

        try {
            await deleteCustomDomainApiKey(id);
            await loadApiKeys();
        } catch (error) {
            clearAndAddHttpError({ key: 'admin:custom-domains', error });
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <SpinnerOverlay visible={loading} />

            <div className={'rounded p-6'} style={{ backgroundColor: colors.secondary }}>
                <div
                    className={'-mx-6 -mt-6 mb-4 rounded-t border-b border-black px-6 py-3'}
                    style={{ backgroundColor: colors.headers }}
                >
                    <h3 className={'text-lg font-semibold text-neutral-100'}>Cloudflare API Keys</h3>
                </div>
                <p className={'mb-4 text-sm text-neutral-400'}>
                    Add multiple Cloudflare API keys with human-readable names. Keys are encrypted at rest.
                </p>

                <div className={'grid grid-cols-1 gap-3 md:grid-cols-3'}>
                    <Input
                        value={name}
                        onChange={e => setName(e.currentTarget.value)}
                        placeholder={'Key name (e.g. Main CF Account)'}
                        autoComplete={'off'}
                    />
                    <Input
                        type={'password'}
                        value={token}
                        onChange={e => setToken(e.currentTarget.value)}
                        placeholder={'Cloudflare API token'}
                        autoComplete={'off'}
                    />
                    <Button onClick={onCreate} disabled={!name.trim() || !token.trim()}>
                        Add API Key
                    </Button>
                </div>

                <div className={'mt-6 space-y-2'}>
                    {apiKeys.length < 1 && (
                        <div
                            className={'rounded border border-neutral-700 p-3 text-sm text-neutral-300'}
                            style={{ backgroundColor: colors.background }}
                        >
                            No API keys configured yet.
                        </div>
                    )}

                    {apiKeys.map(row => (
                        <div
                            key={row.id}
                            className={
                                'flex flex-col gap-3 rounded border border-neutral-700 p-3 md:flex-row md:items-center md:justify-between'
                            }
                            style={{ backgroundColor: colors.background }}
                        >
                            <div>
                                <div className={'text-sm font-semibold text-neutral-100'}>{row.name}</div>
                                <div className={'text-xs text-neutral-400'}>{row.enabled ? 'Enabled' : 'Disabled'}</div>
                            </div>

                            <div className={'flex items-center gap-2'}>
                                <Button
                                    color={'secondary'}
                                    variant={row.enabled ? 'filled' : 'outlined'}
                                    onClick={() => onToggle(row)}
                                >
                                    {row.enabled ? 'Enabled' : 'Disabled'}
                                </Button>
                                <Button color={'secondary'} onClick={() => onDelete(row.id)}>
                                    Delete
                                </Button>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <div className={'mt-6 rounded p-6'} style={{ backgroundColor: colors.secondary }}>
                <div
                    className={'-mx-6 -mt-6 mb-4 rounded-t border-b border-black px-6 py-3'}
                    style={{ backgroundColor: colors.headers }}
                >
                    <h3 className={'text-lg font-semibold text-neutral-100'}>Security & Rate Limits</h3>
                </div>
                <p className={'mb-4 text-sm text-neutral-400'}>
                    Wildcards are fully disabled. Configure API rate limits for custom domain endpoints below.
                </p>
                <div
                    className={'mb-4 rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-300'}
                    style={{ backgroundColor: colors.background }}
                >
                    Rate limits are scoped per authenticated user UUID (fallback to client IP if unauthenticated), not
                    per server and not a single global bucket for all users.
                </div>

                <div className={'grid grid-cols-1 gap-3 md:grid-cols-2'}>
                    <div>
                        <label className={'mb-1 block text-xs text-neutral-400'}>Create requests/minute</label>
                        <Input
                            type={'number'}
                            min={1}
                            max={1000}
                            value={rateLimitCreatePerMinute}
                            onChange={e => setRateLimitCreatePerMinute(Number(e.currentTarget.value || 1))}
                        />
                    </div>

                    <div>
                        <label className={'mb-1 block text-xs text-neutral-400'}>Sync requests/minute</label>
                        <Input
                            type={'number'}
                            min={1}
                            max={1000}
                            value={rateLimitSyncPerMinute}
                            onChange={e => setRateLimitSyncPerMinute(Number(e.currentTarget.value || 1))}
                        />
                    </div>

                    <div className={'md:col-span-2'}>
                        <label className={'mb-1 block text-xs text-neutral-400'}>Billing options requests/minute</label>
                        <Input
                            type={'number'}
                            min={1}
                            max={2000}
                            value={rateLimitBillingOptionsPerMinute}
                            onChange={e => setRateLimitBillingOptionsPerMinute(Number(e.currentTarget.value || 1))}
                        />
                    </div>
                </div>

                <div className={'mt-4'}>
                    <Button onClick={onSaveSecurityAndLimits}>Save Security & Rate Limits</Button>
                </div>
            </div>
        </>
    );
};

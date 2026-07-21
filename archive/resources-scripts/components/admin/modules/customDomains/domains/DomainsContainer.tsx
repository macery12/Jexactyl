import { useEffect, useState } from 'react';
import classNames from 'classnames';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faCheck } from '@fortawesome/free-solid-svg-icons';
import useFlash from '@/plugins/useFlash';
import { useStoreState } from '@/state/hooks';
import { Button } from '@/elements/button';
import Input from '@/elements/Input';
import SpinnerOverlay from '@/elements/SpinnerOverlay';
import {
    AdminCustomDomain,
    CustomDomainApiKey,
    createCustomDomain,
    deleteCustomDomain,
    getCustomDomainApiKeys,
    getCustomDomainTargetOptions,
    getCustomDomains,
    updateCustomDomain,
} from '@/api/routes/admin/customDomains';

export default () => {
    const { clearFlashes, clearAndAddHttpError } = useFlash();
    const { colors } = useStoreState(state => state.theme.data!);

    const [loading, setLoading] = useState(false);
    const [domains, setDomains] = useState<AdminCustomDomain[]>([]);
    const [domain, setDomain] = useState('');
    const [zoneId, setZoneId] = useState('');
    const [apiKeyId, setApiKeyId] = useState<number>(0);
    const [serviceTag, setServiceTag] = useState('');
    const [eggServiceTags, setEggServiceTags] = useState<Record<string, string>>({});
    const [selectedEggForTagId, setSelectedEggForTagId] = useState<number>(0);
    const [selectedEggTagInput, setSelectedEggTagInput] = useState<string>('');
    const [allowedNestIds, setAllowedNestIds] = useState<number[]>([]);
    const [allowedEggIds, setAllowedEggIds] = useState<number[]>([]);
    const [apiKeys, setApiKeys] = useState<CustomDomainApiKey[]>([]);
    const [nests, setNests] = useState<Array<{ id: number; name: string }>>([]);
    const [eggs, setEggs] = useState<
        Array<{ id: number; name: string; nest_id: number; nest_name: string; default_service_tag: string | null }>
    >([]);

    const loadDomains = async () => {
        const rows = await getCustomDomains();
        setDomains(rows);
    };

    const loadOptions = async () => {
        const [keys, options] = await Promise.all([getCustomDomainApiKeys(), getCustomDomainTargetOptions()]);
        setApiKeys(keys);
        setNests(options.nests.map(nest => ({ id: nest.id, name: nest.name })));
        setEggs(
            options.eggs.map(egg => ({
                id: egg.id,
                name: egg.name,
                nest_id: egg.nest_id,
                nest_name: egg.nest_name || `Nest #${egg.nest_id}`,
                default_service_tag: egg.default_service_tag,
            })),
        );

        if (keys[0] && !apiKeyId) {
            setApiKeyId(keys[0].id);
        }
    };

    const toggleNest = (id: number) => {
        setAllowedNestIds(current => (current.includes(id) ? current.filter(item => item !== id) : current.concat(id)));
    };

    const toggleEgg = (id: number) => {
        setAllowedEggIds(current => (current.includes(id) ? current.filter(item => item !== id) : current.concat(id)));
    };

    const filteredEggs = eggs.filter(egg => allowedNestIds.length === 0 || allowedNestIds.includes(egg.nest_id));

    const selectedEggForTag = eggs.find(egg => egg.id === selectedEggForTagId);

    useEffect(() => {
        clearFlashes('admin:custom-domains');
        setLoading(true);

        Promise.all([loadDomains(), loadOptions()])
            .catch(error => clearAndAddHttpError({ key: 'admin:custom-domains', error }))
            .finally(() => setLoading(false));
    }, []);

    const onCreate = async () => {
        if (!domain.trim()) {
            return;
        }

        clearFlashes('admin:custom-domains');
        setLoading(true);

        try {
            await createCustomDomain({
                domain: domain.trim().toLowerCase(),
                cloudflare_zone_id: zoneId.trim() || null,
                api_key_id: apiKeyId || null,
                allowed_nest_ids: allowedNestIds,
                allowed_egg_ids: allowedEggIds,
                service_tag: serviceTag.trim() || null,
                egg_service_tags: eggServiceTags,
                enabled: true,
            });

            setDomain('');
            setZoneId('');
            setServiceTag('');
            setEggServiceTags({});
            setSelectedEggForTagId(0);
            setSelectedEggTagInput('');
            setAllowedNestIds([]);
            setAllowedEggIds([]);

            await loadDomains();
        } catch (error) {
            clearAndAddHttpError({ key: 'admin:custom-domains', error });
        } finally {
            setLoading(false);
        }
    };

    const onToggleEnabled = async (row: AdminCustomDomain) => {
        clearFlashes('admin:custom-domains');
        setLoading(true);

        try {
            await updateCustomDomain(row.id, { enabled: !row.enabled });
            await loadDomains();
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
            await deleteCustomDomain(id);
            await loadDomains();
        } catch (error) {
            clearAndAddHttpError({ key: 'admin:custom-domains', error });
        } finally {
            setLoading(false);
        }
    };

    return (
        <>
            <SpinnerOverlay visible={loading} />

            <div className={'mb-6 grid grid-cols-1 gap-3 md:grid-cols-5'}>
                <div className={'md:col-span-2'}>
                    <Input
                        value={domain}
                        onChange={e => setDomain(e.currentTarget.value)}
                        placeholder={'example.com'}
                    />
                </div>
                <div className={'md:col-span-2'}>
                    <Input
                        value={zoneId}
                        onChange={e => setZoneId(e.currentTarget.value)}
                        placeholder={'Cloudflare zone ID (optional)'}
                    />
                </div>
                <div className={'flex items-center'}>
                    <Button onClick={onCreate} disabled={!domain.trim()}>
                        Add Domain
                    </Button>
                </div>
            </div>

            <div className={'mb-6 grid grid-cols-1 gap-3 md:grid-cols-4'}>
                <div>
                    <select
                        className={'input-dark h-10 w-full rounded border border-neutral-600 px-3 text-sm'}
                        style={{ backgroundColor: colors.background }}
                        value={apiKeyId}
                        onChange={e => setApiKeyId(Number(e.currentTarget.value))}
                    >
                        {apiKeys.map(key => (
                            <option key={key.id} value={key.id}>
                                {key.name}
                            </option>
                        ))}
                    </select>
                </div>
                <div>
                    <Input
                        value={serviceTag}
                        onChange={e => setServiceTag(e.currentTarget.value.toLowerCase())}
                        placeholder={'Default service tag (e.g. _minecraft._)'}
                    />
                </div>
                <div
                    className={'rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-300'}
                    style={{ backgroundColor: colors.background }}
                >
                    SRV is reliable for Minecraft-family eggs. Rust and most other eggs should use CNAME and connect
                    with :port.
                </div>
                <div
                    className={'rounded border border-neutral-700 px-3 py-2 text-xs text-neutral-300'}
                    style={{ backgroundColor: colors.background }}
                >
                    Leave nests/eggs unselected to allow all. SRV tags only affect Minecraft-family servers.
                </div>
            </div>

            <div className={'mb-6 rounded p-4'} style={{ backgroundColor: colors.secondary }}>
                <div
                    className={'-mx-4 -mt-4 mb-3 rounded-t border-b border-black px-4 py-3'}
                    style={{ backgroundColor: colors.headers }}
                >
                    <div className={'text-sm font-medium text-neutral-100'}>Per-Egg Service Tag Override</div>
                </div>
                <div className={'mb-3 text-xs text-neutral-400'}>
                    Select an egg to override its service tag. The field auto-fills with the egg default tag when
                    available.
                </div>
                <div className={'grid grid-cols-1 gap-3 md:grid-cols-3'}>
                    <select
                        className={'input-dark h-10 w-full rounded border border-neutral-600 px-3 text-sm'}
                        style={{ backgroundColor: colors.background }}
                        value={selectedEggForTagId}
                        onChange={e => {
                            const eggId = Number(e.currentTarget.value);
                            const selected = eggs.find(egg => egg.id === eggId);
                            const existing = eggServiceTags[String(eggId)];

                            setSelectedEggForTagId(eggId);
                            setSelectedEggTagInput(existing ?? selected?.default_service_tag ?? '');
                        }}
                    >
                        <option value={0}>Select an egg...</option>
                        {filteredEggs.map(egg => (
                            <option key={egg.id} value={egg.id}>
                                {egg.name} ({egg.nest_name})
                            </option>
                        ))}
                    </select>

                    <Input
                        className={'input-dark h-10 w-full rounded border border-neutral-600 px-3 text-sm'}
                        style={{ backgroundColor: colors.background }}
                        value={selectedEggTagInput}
                        onChange={e => setSelectedEggTagInput(e.currentTarget.value.toLowerCase())}
                        placeholder={selectedEggForTag?.default_service_tag || 'e.g. _minecraft._'}
                        disabled={!selectedEggForTagId}
                    />

                    <div className={'flex items-center gap-2'}>
                        <Button
                            onClick={() => {
                                if (!selectedEggForTagId) {
                                    return;
                                }

                                const value = selectedEggTagInput.trim();
                                if (value === '') {
                                    return;
                                }

                                setEggServiceTags(current => ({ ...current, [String(selectedEggForTagId)]: value }));
                            }}
                            disabled={!selectedEggForTagId || !selectedEggTagInput.trim()}
                        >
                            Save Override
                        </Button>
                        <Button
                            color={'secondary'}
                            onClick={() => {
                                if (!selectedEggForTagId) {
                                    return;
                                }

                                setEggServiceTags(current => {
                                    const next = { ...current };
                                    delete next[String(selectedEggForTagId)];

                                    return next;
                                });
                                setSelectedEggTagInput(selectedEggForTag?.default_service_tag || '');
                            }}
                            disabled={!selectedEggForTagId}
                        >
                            Clear Override
                        </Button>
                    </div>
                </div>
                <div className={'mt-2 text-xs text-neutral-400'}>
                    {selectedEggForTag?.default_service_tag
                        ? `Detected default for this egg: ${selectedEggForTag.default_service_tag}`
                        : 'No SRV default detected for this egg. Recommended: CNAME + :port for non-Minecraft games.'}
                </div>
                <div className={'mt-3 space-y-1 text-xs'}>
                    {Object.keys(eggServiceTags).length < 1 ? (
                        <div className={'text-neutral-500'}>No per-egg overrides configured.</div>
                    ) : (
                        Object.entries(eggServiceTags).map(([eggId, tag]) => {
                            const egg = eggs.find(item => String(item.id) === eggId);

                            return (
                                <div key={eggId} className={'text-neutral-300'}>
                                    {egg?.name || `Egg #${eggId}`} → {tag}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            <div className={'mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2'}>
                <div className={'rounded p-4'} style={{ backgroundColor: colors.secondary }}>
                    <div
                        className={
                            '-mx-4 -mt-4 mb-3 flex items-center justify-between rounded-t border-b border-black px-4 py-3'
                        }
                        style={{ backgroundColor: colors.headers }}
                    >
                        <h4 className={'text-sm font-medium text-neutral-100'}>Allowed Nests</h4>
                        <div className={'space-x-2 text-xs'}>
                            <button
                                onClick={() => setAllowedNestIds(nests.map(nest => nest.id))}
                                className={'text-neutral-400 hover:text-white'}
                            >
                                Select All
                            </button>
                            <span className={'text-neutral-600'}>|</span>
                            <button
                                onClick={() => setAllowedNestIds([])}
                                className={'text-neutral-400 hover:text-white'}
                            >
                                Clear
                            </button>
                        </div>
                    </div>
                    <div className={'grid gap-2 sm:grid-cols-2'}>
                        {nests.map(nest => (
                            <label
                                key={nest.id}
                                className={classNames(
                                    'flex cursor-pointer items-center rounded border p-3 transition-colors',
                                    allowedNestIds.includes(nest.id)
                                        ? 'border-neutral-600 bg-neutral-700/20'
                                        : 'border-neutral-700',
                                )}
                                style={{ backgroundColor: colors.background }}
                            >
                                <input
                                    type={'checkbox'}
                                    checked={allowedNestIds.includes(nest.id)}
                                    onChange={() => toggleNest(nest.id)}
                                    className={'sr-only'}
                                />
                                <div
                                    className={classNames(
                                        'mr-3 flex h-5 w-5 items-center justify-center rounded border-2',
                                        allowedNestIds.includes(nest.id)
                                            ? 'border-transparent'
                                            : 'border-neutral-500 bg-transparent',
                                    )}
                                    style={
                                        allowedNestIds.includes(nest.id)
                                            ? { backgroundColor: colors.primary }
                                            : undefined
                                    }
                                >
                                    {allowedNestIds.includes(nest.id) && (
                                        <FontAwesomeIcon icon={faCheck} className={'text-xs text-white'} />
                                    )}
                                </div>
                                <span className={'text-sm text-neutral-100'}>{nest.name}</span>
                            </label>
                        ))}
                    </div>
                </div>

                <div className={'rounded p-4'} style={{ backgroundColor: colors.secondary }}>
                    <div
                        className={
                            '-mx-4 -mt-4 mb-3 flex items-center justify-between rounded-t border-b border-black px-4 py-3'
                        }
                        style={{ backgroundColor: colors.headers }}
                    >
                        <h4 className={'text-sm font-medium text-neutral-100'}>
                            Allowed Eggs
                            {allowedNestIds.length > 0 && (
                                <span className={'ml-2 text-xs font-normal text-neutral-400'}>
                                    ({filteredEggs.length} in selected nests)
                                </span>
                            )}
                        </h4>
                        <div className={'space-x-2 text-xs'}>
                            <button
                                onClick={() => setAllowedEggIds(filteredEggs.map(egg => egg.id))}
                                className={'text-neutral-400 hover:text-white'}
                            >
                                Select All
                            </button>
                            <span className={'text-neutral-600'}>|</span>
                            <button
                                onClick={() => setAllowedEggIds([])}
                                className={'text-neutral-400 hover:text-white'}
                            >
                                Clear
                            </button>
                        </div>
                    </div>
                    {filteredEggs.length < 1 ? (
                        <div className={'py-6 text-center text-xs text-neutral-500'}>
                            {allowedNestIds.length > 0 ? 'No eggs found in selected nests.' : 'No eggs available.'}
                        </div>
                    ) : (
                        <div className={'grid gap-2 sm:grid-cols-2'}>
                            {filteredEggs.map(egg => (
                                <label
                                    key={egg.id}
                                    className={classNames(
                                        'flex cursor-pointer items-center rounded border p-3 transition-colors',
                                        allowedEggIds.includes(egg.id)
                                            ? 'border-neutral-600 bg-neutral-700/20'
                                            : 'border-neutral-700',
                                    )}
                                    style={{ backgroundColor: colors.background }}
                                >
                                    <input
                                        type={'checkbox'}
                                        checked={allowedEggIds.includes(egg.id)}
                                        onChange={() => toggleEgg(egg.id)}
                                        className={'sr-only'}
                                    />
                                    <div
                                        className={classNames(
                                            'mr-3 flex h-5 w-5 items-center justify-center rounded border-2',
                                            allowedEggIds.includes(egg.id)
                                                ? 'border-transparent'
                                                : 'border-neutral-500 bg-transparent',
                                        )}
                                        style={
                                            allowedEggIds.includes(egg.id)
                                                ? { backgroundColor: colors.primary }
                                                : undefined
                                        }
                                    >
                                        {allowedEggIds.includes(egg.id) && (
                                            <FontAwesomeIcon icon={faCheck} className={'text-xs text-white'} />
                                        )}
                                    </div>
                                    <div>
                                        <div className={'text-sm text-neutral-100'}>{egg.name}</div>
                                        <div className={'text-xs text-neutral-500'}>Nest #{egg.nest_id}</div>
                                    </div>
                                </label>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <div className={'space-y-2 pb-8'}>
                {domains.length < 1 && (
                    <div
                        className={'rounded border border-neutral-700 p-4 text-sm text-neutral-300'}
                        style={{ backgroundColor: colors.secondary }}
                    >
                        No custom domains configured yet.
                    </div>
                )}

                {domains.map(row => (
                    <div
                        key={row.id}
                        className={
                            'flex flex-col gap-3 rounded border border-neutral-700 p-4 md:flex-row md:items-center md:justify-between'
                        }
                        style={{ backgroundColor: colors.secondary }}
                    >
                        <div>
                            <div className={'text-sm font-semibold text-neutral-100'}>{row.domain}</div>
                            <div className={'text-xs text-neutral-400'}>
                                Zone: {row.cloudflare_zone_id || 'Auto-resolve'} • API key: {row.api_key_name || 'none'}
                            </div>
                            <div className={'text-xs text-neutral-500'}>
                                Service tag: {row.service_tag || 'auto (no explicit default)'} • Nests:{' '}
                                {row.allowed_nest_ids?.length || 0} • Eggs: {row.allowed_egg_ids?.length || 0}
                            </div>
                            <div className={'text-xs text-neutral-500'}>
                                Egg overrides: {Object.keys(row.egg_service_tags || {}).length}
                            </div>
                        </div>

                        <div className={'flex items-center gap-2'}>
                            <Button
                                color={'secondary'}
                                variant={row.enabled ? 'filled' : 'outlined'}
                                onClick={() => onToggleEnabled(row)}
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
        </>
    );
};

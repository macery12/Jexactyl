import { useEffect, useMemo, useState } from 'react';
import { useStoreState } from '@/state/hooks';
import AdminBox from '@/elements/AdminBox';
import Spinner from '@/elements/Spinner';
import { Alert } from '@/elements/alert';
import { Button } from '@/elements/button';
import {
    getProviderRules,
    updateProviderRules,
    ProviderRulesResponse,
    ProviderRule,
} from '@/api/routes/admin/marketplace/providers';
import { useFlashKey } from '@/plugins/useFlash';
import classNames from 'classnames';
import Input from '@/elements/Input';
import ToggleSwitch from '@/elements/ToggleSwitch';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/outline';

const providers = [
    { key: 'modrinth.mods', label: 'Modrinth', description: 'Mods' },
    { key: 'modrinth.plugins', label: 'Modrinth (Plugins)', description: 'Plugins' },
    { key: 'spigot.plugins', label: 'Spigot', description: 'Plugins' },
];

const STICKY_BAR_HEIGHT = '5.5rem';

type SearchState = Record<string, { nests: string; eggs: string }>;

const defaultRule = (providerKey: string): ProviderRule => ({
    provider_key: providerKey,
    enabled_global: false,
    allowed_nest_ids: [],
    allowed_egg_ids: [],
});

const normalizeRule = (rule?: ProviderRule, providerKey?: string): ProviderRule => {
    const base = rule ?? defaultRule(providerKey ?? '');
    return {
        provider_key: base.provider_key ?? providerKey ?? '',
        enabled_global: base.enabled_global ?? false,
        allowed_nest_ids: [...(base.allowed_nest_ids ?? [])].sort((a, b) => a - b),
        allowed_egg_ids: [...(base.allowed_egg_ids ?? [])].sort((a, b) => a - b),
    };
};

export const rulesAreEqual = (current?: ProviderRule, initial?: ProviderRule, providerKey?: string) => {
    const next = normalizeRule(current, providerKey);
    const previous = normalizeRule(initial, providerKey ?? next.provider_key);
    const nextNests = next.allowed_nest_ids ?? [];
    const prevNests = previous.allowed_nest_ids ?? [];
    const nextEggs = next.allowed_egg_ids ?? [];
    const prevEggs = previous.allowed_egg_ids ?? [];

    return (
        next.enabled_global === previous.enabled_global &&
        nextNests.length === prevNests.length &&
        nextNests.every((id, index) => id === prevNests[index]) &&
        nextEggs.length === prevEggs.length &&
        nextEggs.every((id, index) => id === prevEggs[index])
    );
};

const hydrateResponse = (response: ProviderRulesResponse): ProviderRulesResponse => ({
    ...response,
    rules: providers.reduce(
        (rules, provider) => {
            rules[provider.key] = normalizeRule(response.rules[provider.key], provider.key);
            return rules;
        },
        { ...response.rules },
    ),
});

const ensureSearchState = (current: SearchState = {}): SearchState => {
    const next = { ...current };
    providers.forEach(provider => {
        if (!next[provider.key]) next[provider.key] = { nests: '', eggs: '' };
    });
    return next;
};

export const saveAllProviders = async (data: ProviderRulesResponse) => {
    const updatePromises = providers.map(provider => {
        const rule = normalizeRule(data.rules[provider.key], provider.key);
        return updateProviderRules({
            provider_key: provider.key,
            enabled_global: rule.enabled_global,
            allowed_nest_ids: rule.allowed_nest_ids ?? [],
            allowed_egg_ids: rule.allowed_egg_ids ?? [],
        });
    });

    await Promise.all(updatePromises);
    const refreshed = await getProviderRules();
    return hydrateResponse(refreshed);
};

function SelectionBadge({ nestCount, eggCount, primaryColor }: { nestCount: number; eggCount: number; primaryColor: string }) {
    if (nestCount === 0 && eggCount === 0) return null;
    return (
        <span
            className={'rounded-full px-2 py-0.5 text-xs font-medium'}
            style={{ backgroundColor: primaryColor + '26', color: primaryColor }}
        >
            {nestCount > 0 && `${nestCount} nest${nestCount !== 1 ? 's' : ''}`}
            {nestCount > 0 && eggCount > 0 && ' · '}
            {eggCount > 0 && `${eggCount} egg${eggCount !== 1 ? 's' : ''}`}
        </span>
    );
}

export default function AccessControlContainer() {
    const [data, setData] = useState<ProviderRulesResponse | null>(null);
    const [initialData, setInitialData] = useState<ProviderRulesResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [search, setSearch] = useState<SearchState>({});
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const { colors } = useStoreState(s => s.theme.data!);

    const { clearAndAddHttpError, clearFlashes, addFlash } = useFlashKey('admin:marketplace');

    useEffect(() => {
        clearFlashes();
        setLoading(true);
        getProviderRules()
            .then(response => {
                const hydrated = hydrateResponse(response);
                setInitialData(hydrated);
                setData(hydrated);
                setSearch(state => ensureSearchState(state));
                // Default: expand providers that already have selections
                setExpanded(
                    providers.reduce(
                        (acc, p) => {
                            const rule = hydrated.rules[p.key];
                            acc[p.key] =
                                (rule?.allowed_nest_ids?.length ?? 0) > 0 ||
                                (rule?.allowed_egg_ids?.length ?? 0) > 0 ||
                                rule?.enabled_global === true;
                            return acc;
                        },
                        {} as Record<string, boolean>,
                    ),
                );
            })
            .catch(clearAndAddHttpError)
            .finally(() => setLoading(false));
    }, []);

    const hasChanges = useMemo(() => {
        if (!data || !initialData) return false;
        return providers.some(
            provider =>
                !rulesAreEqual(
                    data.rules[provider.key] ?? defaultRule(provider.key),
                    initialData.rules[provider.key] ?? defaultRule(provider.key),
                    provider.key,
                ),
        );
    }, [data, initialData]);

    const updateRule = (providerKey: string, updater: (rule: ProviderRule) => ProviderRule) => {
        if (saving) return;
        setData(current => {
            if (!current) return current;
            const existing = normalizeRule(current.rules[providerKey], providerKey);
            const updated = normalizeRule(updater(existing), providerKey);
            return { ...current, rules: { ...current.rules, [providerKey]: updated } };
        });
    };

    const toggleNest = (providerKey: string, id: number) => {
        updateRule(providerKey, rule => {
            const list = new Set(rule.allowed_nest_ids ?? []);
            list.has(id) ? list.delete(id) : list.add(id);
            return { ...rule, allowed_nest_ids: Array.from(list).sort((a, b) => a - b) };
        });
    };

    const toggleEgg = (providerKey: string, id: number) => {
        updateRule(providerKey, rule => {
            const list = new Set(rule.allowed_egg_ids ?? []);
            list.has(id) ? list.delete(id) : list.add(id);
            return { ...rule, allowed_egg_ids: Array.from(list).sort((a, b) => a - b) };
        });
    };

    const toggleEnabled = (providerKey: string) => {
        updateRule(providerKey, rule => ({ ...rule, enabled_global: !rule.enabled_global }));
    };

    const selectAllNests = (providerKey: string, ids: number[]) => {
        updateRule(providerKey, rule => ({ ...rule, allowed_nest_ids: ids }));
    };

    const clearNests = (providerKey: string) => {
        updateRule(providerKey, rule => ({ ...rule, allowed_nest_ids: [] }));
    };

    const selectAllEggs = (providerKey: string, ids: number[]) => {
        updateRule(providerKey, rule => ({ ...rule, allowed_egg_ids: ids }));
    };

    const clearEggs = (providerKey: string) => {
        updateRule(providerKey, rule => ({ ...rule, allowed_egg_ids: [] }));
    };

    const handleResetAll = () => {
        if (saving || !initialData) return;
        setData(initialData);
    };

    const handleSaveAll = () => {
        if (!data || saving) return;

        setSaving(true);
        saveAllProviders(data)
            .then(hydrated => {
                setData(hydrated);
                setInitialData(hydrated);
                addFlash({ type: 'success', title: 'Saved', message: 'Access control rules updated.' });
            })
            .catch(clearAndAddHttpError)
            .finally(() => setSaving(false));
    };

    if (loading || !data || !initialData) {
        return (
            <div className={'flex flex-col items-center gap-3 py-10'}>
                <Spinner size={'large'} />
                <p className={'text-sm text-neutral-300'}>Loading access rules…</p>
            </div>
        );
    }

    return (
        <div className={'space-y-4'} style={{ paddingBottom: STICKY_BAR_HEIGHT }}>
            <Alert type={'info'}>
                Default policy: All providers are denied unless explicitly enabled and allowed for specific nests/eggs.
                Selecting eggs overrides nest rules for finer control.
            </Alert>

            {providers.map(provider => {
                const rule = data.rules[provider.key] ?? defaultRule(provider.key);
                const providerSearch = search[provider.key] ?? { nests: '', eggs: '' };
                const controlsDisabled = !rule.enabled_global || saving;
                const isExpanded = expanded[provider.key] ?? false;

                const nestQuery = providerSearch.nests.toLowerCase();
                const eggQuery = providerSearch.eggs.toLowerCase();
                const filteredNests = data.nests.filter(nest => nest.name.toLowerCase().includes(nestQuery));
                const allEggs = data.nests.flatMap(nest => nest.eggs ?? []);
                const filteredEggs = allEggs.filter(egg => egg.name.toLowerCase().includes(eggQuery));

                const nestCount = rule.allowed_nest_ids?.length ?? 0;
                const eggCount = rule.allowed_egg_ids?.length ?? 0;

                return (
                    <AdminBox
                        key={provider.key}
                        title={
                            <button
                                type={'button'}
                                className={'flex w-full items-center gap-3 text-left'}
                                onClick={() =>
                                    setExpanded(prev => ({ ...prev, [provider.key]: !prev[provider.key] }))
                                }
                            >
                                <span className={'text-neutral-400'}>
                                    {isExpanded ? (
                                        <ChevronDownIcon className={'h-4 w-4'} />
                                    ) : (
                                        <ChevronRightIcon className={'h-4 w-4'} />
                                    )}
                                </span>
                                <div className={'flex flex-1 flex-wrap items-center gap-x-3 gap-y-1'}>
                                    <span className={'text-base font-semibold text-neutral-50'}>{provider.label}</span>
                                    <span className={'text-sm text-neutral-400'}>{provider.description}</span>
                                    <SelectionBadge nestCount={nestCount} eggCount={eggCount} primaryColor={colors.primary} />
                                </div>
                                <div
                                    className={classNames(
                                        'h-2 w-2 flex-shrink-0 rounded-full',
                                        rule.enabled_global ? 'bg-green-400' : 'bg-neutral-600',
                                    )}
                                    title={rule.enabled_global ? 'Enabled' : 'Disabled'}
                                />
                            </button>
                        }
                    >
                        {isExpanded && (
                            <div className={'flex flex-col gap-6'}>
                                <div className={'flex items-center justify-between gap-4'}>
                                    <div>
                                        <p className={'text-sm font-medium text-neutral-200'}>Provider Enabled</p>
                                        <p className={'text-xs text-neutral-400'}>
                                            Allow this provider to serve content.
                                        </p>
                                    </div>
                                    <ToggleSwitch
                                        checked={rule.enabled_global}
                                        onChange={() => toggleEnabled(provider.key)}
                                        disabled={saving}
                                        label={`Toggle ${provider.label} provider`}
                                    />
                                </div>

                                <div
                                    className={classNames(
                                        'grid gap-5 lg:grid-cols-2',
                                        !rule.enabled_global && 'opacity-60',
                                        controlsDisabled && 'pointer-events-none',
                                    )}
                                >
                                    {/* Nests */}
                                    <div className={'flex flex-col gap-3'}>
                                        <div className={'flex items-center justify-between'}>
                                            <div>
                                                <p className={'text-sm font-semibold text-neutral-50'}>Nests Allowed</p>
                                                <p className={'text-xs text-neutral-400'}>
                                                    Select nests this provider can use.
                                                </p>
                                            </div>
                                            <div className={'flex items-center gap-3 text-xs text-neutral-300'}>
                                                <button
                                                    type={'button'}
                                                    className={'hover:text-neutral-200'}
                                                    onClick={() =>
                                                        selectAllNests(
                                                            provider.key,
                                                            filteredNests.map(n => n.id),
                                                        )
                                                    }
                                                    disabled={controlsDisabled}
                                                >
                                                    Select all
                                                </button>
                                                <span className={'text-neutral-600'}>|</span>
                                                <button
                                                    type={'button'}
                                                    className={'hover:text-neutral-200'}
                                                    onClick={() => clearNests(provider.key)}
                                                    disabled={controlsDisabled}
                                                >
                                                    Clear
                                                </button>
                                            </div>
                                        </div>
                                        <Input
                                            type={'search'}
                                            placeholder={'Search nests…'}
                                            value={providerSearch.nests}
                                            disabled={controlsDisabled}
                                            onChange={e =>
                                                setSearch(state =>
                                                    ensureSearchState({
                                                        ...state,
                                                        [provider.key]: { ...providerSearch, nests: e.target.value },
                                                    }),
                                                )
                                            }
                                        />
                                        <div className={'grid gap-2 md:grid-cols-2 xl:grid-cols-3'}>
                                            {filteredNests.length === 0 && (
                                                <div className={'col-span-full text-sm text-neutral-500'}>
                                                    No nests match.
                                                </div>
                                            )}
                                            {filteredNests.map(nest => {
                                                const selected = (rule.allowed_nest_ids ?? []).includes(nest.id);
                                                return (
                                                    <label
                                                        key={nest.id}
                                                        className={classNames(
                                                            'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 transition hover:border-neutral-500',
                                                            !selected && 'border-neutral-700 bg-neutral-800/40 hover:bg-neutral-800/60',
                                                        )}
                                                        style={selected ? { borderColor: colors.primary, backgroundColor: colors.primary + '1a' } : undefined}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            className={'h-4 w-4 rounded border-neutral-600 bg-neutral-900'}
                                                            style={{ accentColor: colors.primary }}
                                                            checked={selected}
                                                            onChange={() => toggleNest(provider.key, nest.id)}
                                                            disabled={controlsDisabled}
                                                        />
                                                        <span className={'text-sm text-neutral-100'}>{nest.name}</span>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* Eggs */}
                                    <div className={'flex flex-col gap-3'}>
                                        <div className={'flex items-center justify-between'}>
                                            <div>
                                                <p className={'text-sm font-semibold text-neutral-50'}>Eggs Allowed</p>
                                                <p className={'text-xs text-neutral-400'}>
                                                    Eggs override nest rules for finer control.
                                                </p>
                                            </div>
                                            <div className={'flex items-center gap-3 text-xs text-neutral-300'}>
                                                <button
                                                    type={'button'}
                                                    className={'hover:text-neutral-200'}
                                                    onClick={() =>
                                                        selectAllEggs(
                                                            provider.key,
                                                            filteredEggs.map(egg => egg.id),
                                                        )
                                                    }
                                                    disabled={controlsDisabled}
                                                >
                                                    Select all
                                                </button>
                                                <span className={'text-neutral-600'}>|</span>
                                                <button
                                                    type={'button'}
                                                    className={'hover:text-neutral-200'}
                                                    onClick={() => clearEggs(provider.key)}
                                                    disabled={controlsDisabled}
                                                >
                                                    Clear
                                                </button>
                                            </div>
                                        </div>
                                        <Input
                                            type={'search'}
                                            placeholder={'Search eggs…'}
                                            value={providerSearch.eggs}
                                            disabled={controlsDisabled}
                                            onChange={e =>
                                                setSearch(state =>
                                                    ensureSearchState({
                                                        ...state,
                                                        [provider.key]: { ...providerSearch, eggs: e.target.value },
                                                    }),
                                                )
                                            }
                                        />
                                        <div className={'grid gap-2 md:grid-cols-2 xl:grid-cols-3'}>
                                            {filteredEggs.length === 0 && (
                                                <div className={'col-span-full text-sm text-neutral-500'}>
                                                    No eggs match.
                                                </div>
                                            )}
                                            {filteredEggs.map(egg => {
                                                const selected = (rule.allowed_egg_ids ?? []).includes(egg.id);
                                                return (
                                                    <label
                                                        key={egg.id}
                                                        className={classNames(
                                                            'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 transition hover:border-neutral-500',
                                                            !selected && 'border-neutral-700 bg-neutral-800/40 hover:bg-neutral-800/60',
                                                        )}
                                                        style={selected ? { borderColor: colors.primary, backgroundColor: colors.primary + '1a' } : undefined}
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            className={'h-4 w-4 rounded border-neutral-600 bg-neutral-900'}
                                                            style={{ accentColor: colors.primary }}
                                                            checked={selected}
                                                            onChange={() => toggleEgg(provider.key, egg.id)}
                                                            disabled={controlsDisabled}
                                                        />
                                                        <span className={'text-sm text-neutral-100'}>{egg.name}</span>
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </AdminBox>
                );
            })}

            {/* Sticky save bar */}
            <div
                className={
                    'sticky bottom-0 z-10 flex flex-col gap-3 border-t border-neutral-800 bg-neutral-900/90 px-4 py-3 backdrop-blur'
                }
                style={{ minHeight: STICKY_BAR_HEIGHT }}
            >
                <div className={'flex items-center justify-between'}>
                    <div className={'flex items-center gap-3'}>
                        <div aria-live={'polite'}>
                            {hasChanges ? (
                                <div className={'flex items-center gap-2 text-sm text-amber-400'}>
                                    <span className={'h-2 w-2 animate-pulse rounded-full bg-amber-400'} />
                                    Unsaved changes
                                </div>
                            ) : (
                                <div className={'text-sm text-neutral-500'}>All changes saved</div>
                            )}
                        </div>
                        {saving && (
                            <div className={'flex items-center gap-2 text-sm text-neutral-300'}>
                                <Spinner size={'small'} />
                                Saving…
                            </div>
                        )}
                    </div>
                    <div className={'flex items-center gap-2'}>
                        <Button.Text onClick={handleResetAll} disabled={!hasChanges || saving}>
                            Reset
                        </Button.Text>
                        <Button disabled={!hasChanges || saving} onClick={handleSaveAll}>
                            {saving ? 'Saving…' : 'Save All'}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
}

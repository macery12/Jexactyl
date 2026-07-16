import { useEffect, useMemo, useState } from 'react';
import tw from 'twin.macro';
import Input from '@/elements/Input';
import Select from '@/elements/Select';
import Spinner from '@/elements/Spinner';
import { Button } from '@/elements/button';
import useFlash, { useFlashKey } from '@/plugins/useFlash';
import PageContentBlock from '@/elements/PageContentBlock';
import { ServerContext } from '@/state/server';
import { useStoreState } from '@/state/hooks';
import {
    createServerCustomDomain,
    deleteServerCustomDomain,
    getServerCustomDomainOptions,
    getServerCustomDomains,
    syncServerCustomDomains,
} from '@/api/routes/server/customDomains';

interface DomainOption {
    id: number;
    domain: string;
    wildcard_enabled: boolean;
    default_service_tag: string | null;
    recommended_record_type: 'srv' | 'cname';
    srv_supported: boolean;
    allow_record_type_selection: boolean;
    forced_record_type: 'srv' | 'cname' | null;
    dns_mode: 'minecraft' | 'rust' | 'generic';
    recommendation_notice: string;
    connection_hint: string;
}

const CustomDomainsContainer = () => {
    const { colors } = useStoreState(state => state.theme.data!);
    const uuid = ServerContext.useStoreState(state => state.server.data!.uuid);
    const allocations = ServerContext.useStoreState(state => state.server.data!.allocations);
    const subdomainLimit = ServerContext.useStoreState(state => state.server.data!.featureLimits.subdomains);
    const defaultAllocation = ServerContext.useStoreState(state =>
        state.server.data!.allocations.find(a => a.isDefault),
    );

    const { clearFlashes, clearAndAddHttpError } = useFlashKey('server:custom-domains');
    const { addFlash } = useFlash();

    const [loading, setLoading] = useState(false);
    const [options, setOptions] = useState<DomainOption[]>([]);
    const [domainId, setDomainId] = useState<number>(0);
    const [subdomain, setSubdomain] = useState<string>('');
    const [port, setPort] = useState<number>(defaultAllocation?.port || allocations[0]?.port || 25565);
    const [protocol, setProtocol] = useState<'tcp' | 'udp' | 'both'>('both');
    const [recordType, setRecordType] = useState<'srv' | 'cname'>('cname');
    const [serviceTag, setServiceTag] = useState<string>('');

    const { data, error, mutate } = getServerCustomDomains();

    useEffect(() => {
        clearFlashes();

        getServerCustomDomainOptions(uuid)
            .then(domains => {
                setOptions(domains);
                const firstDomain = domains[0];
                if (firstDomain) {
                    setDomainId(firstDomain.id);
                    setRecordType(firstDomain.recommended_record_type);
                    setServiceTag(firstDomain.default_service_tag ?? '');
                }
            })
            .catch(error => clearAndAddHttpError(error));
    }, []);

    useEffect(() => {
        if (error) {
            clearAndAddHttpError(error);
        }
    }, [error]);

    const selectedDomain = useMemo(() => options.find(item => item.id === domainId), [options, domainId]);
    const effectiveRecordType: 'srv' | 'cname' = selectedDomain?.allow_record_type_selection
        ? recordType
        : (selectedDomain?.forced_record_type ?? selectedDomain?.recommended_record_type ?? 'cname');
    const supportsSrv = effectiveRecordType === 'srv';
    const currentSubdomainCount = data?.length ?? 0;
    const hasUnlimitedSubdomains = subdomainLimit === null || subdomainLimit === undefined;
    const isSubdomainLimitReached = !hasUnlimitedSubdomains && currentSubdomainCount >= subdomainLimit;
    const allocationPorts = useMemo(
        () => Array.from(new Set(allocations.map(allocation => allocation.port))),
        [allocations],
    );

    useEffect(() => {
        if (allocationPorts.length < 1) {
            return;
        }

        if (!allocationPorts.includes(port)) {
            const firstPort = allocationPorts[0];
            if (firstPort !== undefined) {
                setPort(firstPort);
            }
        }
    }, [allocationPorts, port]);

    const onCreate = () => {
        clearFlashes();

        if (isSubdomainLimitReached) {
            addFlash({
                type: 'error',
                key: 'server:custom-domains',
                message: `Subdomain limit reached (${currentSubdomainCount}/${subdomainLimit}).`,
            });

            return;
        }

        setLoading(true);

        createServerCustomDomain(uuid, {
            domain_id: domainId,
            subdomain,
            port,
            protocol,
            record_type: effectiveRecordType,
            service_tag: supportsSrv ? serviceTag.trim() || undefined : undefined,
        })
            .then(() => {
                addFlash({
                    type: 'success',
                    key: 'server:custom-domains',
                    message: 'Custom domain has been queued for provisioning.',
                });

                setSubdomain('');
                return mutate();
            })
            .catch(error => clearAndAddHttpError(error))
            .finally(() => setLoading(false));
    };

    const onDelete = (id: number) => {
        clearFlashes();

        deleteServerCustomDomain(uuid, id)
            .then(() => mutate())
            .catch(error => clearAndAddHttpError(error));
    };

    const onSync = () => {
        clearFlashes();

        syncServerCustomDomains(uuid)
            .then(() => {
                addFlash({
                    type: 'success',
                    key: 'server:custom-domains',
                    message: 'DNS synchronization has been queued.',
                });
            })
            .catch(error => clearAndAddHttpError(error));
    };

    return (
        <PageContentBlock
            title={'Custom Domains'}
            description={'Manage custom domains and DNS mappings for this server.'}
            showFlashKey={'server:custom-domains'}
            header
        >
            {!data ? (
                <Spinner centered size={'large'} />
            ) : (
                <>
                    {selectedDomain && (
                        <div
                            css={tw`mb-6 overflow-hidden rounded text-sm`}
                            style={{ backgroundColor: colors.secondary }}
                        >
                            <div
                                css={tw`border-b border-black px-4 py-3 font-semibold text-neutral-100`}
                                style={{ backgroundColor: colors.headers }}
                            >
                                DNS Recommendation
                            </div>
                            <div css={tw`px-4 py-4`}>
                                <div css={tw`mb-1 font-semibold text-neutral-100`}>
                                    {!selectedDomain.allow_record_type_selection &&
                                    selectedDomain.forced_record_type === 'cname'
                                        ? 'CNAME Only'
                                        : selectedDomain.recommended_record_type === 'srv'
                                          ? 'SRV Recommended'
                                          : 'CNAME Recommended'}
                                </div>
                                <div css={tw`text-neutral-300`}>{selectedDomain.recommendation_notice}</div>
                                <div css={tw`mt-1 text-xs text-neutral-400`}>{selectedDomain.connection_hint}</div>
                            </div>
                        </div>
                    )}

                    <div css={tw`mb-6 overflow-hidden rounded`} style={{ backgroundColor: colors.secondary }}>
                        <div
                            css={tw`border-b border-black px-4 py-3 font-semibold text-neutral-100`}
                            style={{ backgroundColor: colors.headers }}
                        >
                            Add Mapping
                        </div>
                        <div css={tw`px-4 py-4`}>
                            <div css={tw`mb-6 grid grid-cols-1 gap-3 md:grid-cols-6`}>
                                <div css={tw`md:col-span-2`}>
                                    <Input
                                        value={subdomain}
                                        onChange={e => setSubdomain(e.currentTarget.value.toLowerCase())}
                                        placeholder={'subdomain'}
                                    />
                                </div>
                                <div css={tw`md:col-span-2`}>
                                    <Select
                                        value={domainId}
                                        onChange={e => {
                                            const selected = options.find(
                                                option => option.id === Number(e.currentTarget.value),
                                            );
                                            setDomainId(Number(e.currentTarget.value));
                                            setRecordType(selected?.recommended_record_type ?? 'cname');
                                            setServiceTag(selected?.default_service_tag ?? '');
                                        }}
                                    >
                                        {options.map(option => (
                                            <option key={option.id} value={option.id}>
                                                {option.domain}
                                            </option>
                                        ))}
                                    </Select>
                                    <div css={tw`mt-2 text-xs text-neutral-400`}>
                                        {effectiveRecordType === 'srv'
                                            ? selectedDomain?.default_service_tag
                                                ? `Default SRV tag: ${selectedDomain.default_service_tag}`
                                                : 'Default SRV tag: none (set one manually if needed)'
                                            : selectedDomain?.dns_mode === 'rust'
                                              ? 'CNAME selected (recommended). Connect using :port.'
                                              : 'CNAME is the only supported option for this game profile. Connect using :port.'}
                                    </div>
                                </div>
                                <div>
                                    <Select
                                        value={effectiveRecordType}
                                        disabled={!selectedDomain?.allow_record_type_selection}
                                        onChange={e => setRecordType(e.currentTarget.value as 'srv' | 'cname')}
                                    >
                                        <option value={'cname'}>
                                            {selectedDomain?.dns_mode === 'minecraft'
                                                ? 'CNAME (supported)'
                                                : selectedDomain?.dns_mode === 'rust'
                                                  ? 'CNAME (recommended)'
                                                  : 'CNAME (only supported option)'}
                                        </option>
                                        {selectedDomain?.allow_record_type_selection && (
                                            <option value={'srv'}>
                                                {selectedDomain.dns_mode === 'minecraft'
                                                    ? 'SRV (recommended)'
                                                    : 'SRV (not recommended)'}
                                            </option>
                                        )}
                                    </Select>
                                </div>
                                {supportsSrv ? (
                                    <div>
                                        <Input
                                            value={serviceTag}
                                            onChange={e => setServiceTag(e.currentTarget.value.toLowerCase())}
                                            placeholder={'Service tag (optional, e.g. _minecraft._)'}
                                        />
                                    </div>
                                ) : (
                                    <div />
                                )}
                                <div>
                                    <Select value={port} onChange={e => setPort(Number(e.currentTarget.value))}>
                                        {allocationPorts.map(allocationPort => (
                                            <option key={allocationPort} value={allocationPort}>
                                                {allocationPort}
                                            </option>
                                        ))}
                                    </Select>
                                </div>
                                <div>
                                    <Select
                                        value={protocol}
                                        onChange={e => setProtocol(e.currentTarget.value as 'tcp' | 'udp' | 'both')}
                                    >
                                        <option value={'both'}>Both</option>
                                        <option value={'tcp'}>TCP</option>
                                        <option value={'udp'}>UDP</option>
                                    </Select>
                                </div>
                            </div>
                            <div css={tw`mb-3 text-sm text-neutral-300`}>
                                {hasUnlimitedSubdomains
                                    ? `${currentSubdomainCount} (Unlimited)`
                                    : `${currentSubdomainCount} / ${subdomainLimit}`}
                            </div>
                            <div css={tw`flex items-center justify-end`}>
                                <div css={tw`space-x-2`}>
                                    <Button color={'secondary'} onClick={onSync}>
                                        Sync DNS
                                    </Button>
                                    <Button
                                        color={'primary'}
                                        disabled={loading || !domainId || !subdomain || isSubdomainLimitReached}
                                        onClick={onCreate}
                                    >
                                        Add Mapping
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div css={tw`overflow-hidden rounded`} style={{ backgroundColor: colors.secondary }}>
                        <div
                            css={tw`border-b border-black px-4 py-3 font-semibold text-neutral-100`}
                            style={{ backgroundColor: colors.headers }}
                        >
                            Current Mappings
                        </div>
                        <div css={tw`space-y-2 px-4 py-4`}>
                            {data.length < 1 && (
                                <div
                                    css={tw`rounded border border-neutral-700 p-4 text-sm text-neutral-300`}
                                    style={{ backgroundColor: colors.secondary }}
                                >
                                    No custom domains configured for this server yet.
                                </div>
                            )}

                            {data.map(row => (
                                <div
                                    key={row.id}
                                    css={tw`flex flex-col gap-2 rounded border border-neutral-700 p-4 md:flex-row md:items-center md:justify-between`}
                                    style={{ backgroundColor: colors.secondary }}
                                >
                                    <div>
                                        <div css={tw`text-sm font-semibold text-neutral-100`}>{row.full_domain}</div>
                                        <div css={tw`text-xs text-neutral-300`}>
                                            Port {row.port} • {row.protocol.toUpperCase()} •{' '}
                                            {row.record_type === 'srv'
                                                ? `SRV service: ${row.service_tag || 'auto'}`
                                                : 'CNAME mapping (connect using :port)'}
                                        </div>
                                        <div css={tw`text-xs text-neutral-400`}>Status: {row.status}</div>
                                        {row.last_error && <div css={tw`text-xs text-red-400`}>{row.last_error}</div>}
                                    </div>

                                    <Button color={'secondary'} onClick={() => onDelete(row.id)}>
                                        Remove
                                    </Button>
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}
        </PageContentBlock>
    );
};

export default CustomDomainsContainer;

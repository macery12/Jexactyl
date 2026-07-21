import AdminBox from '@/elements/AdminBox';
import { useStoreState } from '@/state/hooks';
import { useEffect, useState } from 'react';
import { useFlashKey } from '@/plugins/useFlash';
import Spinner from '@/elements/Spinner';
import { getMarketplaceAnalytics, MarketplaceAnalytics } from '@/api/routes/admin/marketplace/settings';
import { formatBytes } from '@/lib/formatBytes';
import {
    DownloadIcon,
    ExclamationCircleIcon,
    RefreshIcon,
    DatabaseIcon,
    ChartBarIcon,
    LightningBoltIcon,
    ShieldCheckIcon,
    CogIcon,
} from '@heroicons/react/outline';
import { CheckCircleIcon, XCircleIcon } from '@heroicons/react/solid';
import { Link } from 'react-router-dom';
import { Button } from '@/elements/button';

const providerLabels: Record<string, string> = {
    modrinth: 'Modrinth',
    spigot: 'Spigot',
    curseforge: 'CurseForge',
};

const healthProviderLabels: Record<string, string> = {
    'modrinth.mods': 'Modrinth Mods',
    'modrinth.plugins': 'Modrinth Plugins',
    'spigot.plugins': 'Spigot',
    modrinth: 'Modrinth',
    spigot: 'Spigot',
    curseforge: 'CurseForge',
};

function StatCard({
    label,
    value,
    sub,
    icon: Icon,
    accent,
    primaryColor,
    secondaryColor,
}: {
    label: string;
    value: string | number;
    sub?: string;
    icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
    accent?: 'amber' | 'red' | 'green';
    primaryColor?: string;
    secondaryColor?: string;
}) {
    const accentClass = accent === 'amber' ? 'text-amber-400' : accent === 'red' ? 'text-red-400' : undefined;
    const iconStyle = !accentClass && primaryColor ? { color: primaryColor } : undefined;
    return (
        <div className={'flex flex-col gap-2 rounded-lg border border-neutral-700 p-4'} style={{ backgroundColor: secondaryColor }}>
            <div className={'flex items-center justify-between'}>
                <span className={'text-xs font-medium uppercase tracking-wide text-neutral-400'}>{label}</span>
                <Icon className={`h-4 w-4 ${accentClass ?? ''}`} style={iconStyle} />
            </div>
            <div className={`text-2xl font-bold text-neutral-50`}>{value}</div>
            {sub && <div className={'text-xs text-neutral-400'}>{sub}</div>}
        </div>
    );
}

function ProviderBar({ label, count, total, primaryColor }: { label: string; count: number; total: number; primaryColor: string }) {
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    return (
        <div className={'flex flex-col gap-1'}>
            <div className={'flex items-center justify-between text-sm'}>
                <span className={'text-neutral-300'}>{label}</span>
                <span className={'font-medium text-neutral-100'}>
                    {count.toLocaleString()}
                    <span className={'ml-1.5 text-xs text-neutral-500'}>{pct}%</span>
                </span>
            </div>
            <div className={'h-1.5 w-full overflow-hidden rounded-full bg-neutral-700'}>
                <div className={'h-full rounded-full transition-all'} style={{ width: `${pct}%`, backgroundColor: primaryColor }} />
            </div>
        </div>
    );
}

export default function OverviewContainer() {
    const [analytics, setAnalytics] = useState<MarketplaceAnalytics | null>(null);
    const [loading, setLoading] = useState(true);
    const { clearFlashes, clearAndAddHttpError } = useFlashKey('admin:marketplace');
    const { colors } = useStoreState(s => s.theme.data!);

    useEffect(() => {
        clearFlashes();
        getMarketplaceAnalytics()
            .then(data => {
                setAnalytics(data);
                setLoading(false);
            })
            .catch(error => {
                clearAndAddHttpError(error);
                setLoading(false);
            });
    }, []);

    if (loading) {
        return (
            <div className={'flex flex-col items-center gap-3 py-16'}>
                <Spinner size={'large'} />
                <p className={'text-sm text-neutral-400'}>Loading analytics…</p>
            </div>
        );
    }

    const totals = analytics?.totals;
    const queue = analytics?.queue;
    const totalInstalls = totals?.installs ?? 0;
    const byProvider = totals?.by_provider ?? { modrinth: 0, spigot: 0, curseforge: 0 };
    const totalActive = (queue?.pending ?? 0) + (queue?.downloading ?? 0);

    return (
        <div className={'grid gap-6 lg:grid-cols-3'}>
            <div className={'col-span-2 flex flex-col gap-6'}>
                {/* Stat cards */}
                <div className={'grid grid-cols-2 gap-3 xl:grid-cols-4'}>
                    <StatCard
                        label={'Total Installs'}
                        value={totalInstalls.toLocaleString()}
                        sub={'All time, all providers'}
                        icon={DownloadIcon}
                        accent={'green'}
                        primaryColor={colors.primary}
                        secondaryColor={colors.secondary}
                    />
                    <StatCard
                        label={'Failures'}
                        value={totals?.failures ?? 0}
                        sub={`${totals?.retries ?? 0} retries`}
                        icon={ExclamationCircleIcon}
                        accent={totals?.failures ? 'red' : undefined}
                        primaryColor={colors.primary}
                        secondaryColor={colors.secondary}
                    />
                    <StatCard
                        label={'Bandwidth'}
                        value={formatBytes(totals?.bandwidth_bytes ?? 0)}
                        sub={`${formatBytes(totals?.bandwidth_bytes_24h ?? 0)} last 24h`}
                        icon={DatabaseIcon}
                        primaryColor={colors.primary}
                        secondaryColor={colors.secondary}
                    />
                    <StatCard
                        label={'Retries'}
                        value={totals?.retries ?? 0}
                        sub={'Auto-retry attempts'}
                        icon={RefreshIcon}
                        accent={totals?.retries ? 'amber' : undefined}
                        primaryColor={colors.primary}
                        secondaryColor={colors.secondary}
                    />
                </div>

                {/* Queue health cards */}
                <div className={'grid grid-cols-3 gap-3'}>
                    <StatCard
                        label={'Queued (Pending)'}
                        value={queue?.pending ?? 0}
                        sub={'Waiting to download'}
                        icon={RefreshIcon}
                        accent={queue?.pending ? 'amber' : undefined}
                        primaryColor={colors.primary}
                        secondaryColor={colors.secondary}
                    />
                    <StatCard
                        label={'Downloading Now'}
                        value={queue?.downloading ?? 0}
                        sub={'Across all servers'}
                        icon={DownloadIcon}
                        accent={totalActive > 0 ? 'green' : undefined}
                        primaryColor={colors.primary}
                        secondaryColor={colors.secondary}
                    />
                    <StatCard
                        label={'Queue Failures (24h)'}
                        value={queue?.failed_24h ?? 0}
                        sub={'Failed queue jobs'}
                        icon={ExclamationCircleIcon}
                        accent={queue?.failed_24h ? 'red' : undefined}
                        primaryColor={colors.primary}
                        secondaryColor={colors.secondary}
                    />
                </div>

                {/* Provider breakdown */}
                {analytics && (
                    <AdminBox title={'Installs by Provider'} icon={ChartBarIcon}>
                        <div className={'flex flex-col gap-3'}>
                            {Object.entries(byProvider).map(([key, count]) => (
                                <ProviderBar
                                    key={key}
                                    label={providerLabels[key] ?? key}
                                    count={count}
                                    total={totalInstalls}
                                    primaryColor={colors.primary}
                                />
                            ))}
                            {totalInstalls === 0 && (
                                <p className={'text-sm text-neutral-500'}>No installs recorded yet.</p>
                            )}
                        </div>
                    </AdminBox>
                )}

                {/* Provider health */}
                {analytics && Object.keys(analytics.provider_health).length > 0 && (
                    <AdminBox title={'Provider Health'} icon={LightningBoltIcon}>
                        <div className={'grid gap-3 sm:grid-cols-2'}>
                            {Object.entries(analytics.provider_health).map(([key, health]) => {
                                const hasDenials = health.denied_by_policy > 0;
                                return (
                                    <div
                                        key={key}
                                        className={'flex flex-col gap-2 rounded-md border border-neutral-700 p-3'}
                                        style={{ backgroundColor: colors.secondary }}
                                    >
                                        <div className={'flex items-center justify-between'}>
                                            <span className={'text-sm font-medium text-neutral-200'}>
                                                {healthProviderLabels[key] ?? key}
                                            </span>
                                            {health.enabled ? (
                                                <span className={'flex items-center gap-1 text-xs text-green-400'}>
                                                    <CheckCircleIcon className={'h-4 w-4'} />
                                                    Enabled
                                                </span>
                                            ) : (
                                                <span className={'flex items-center gap-1 text-xs text-neutral-500'}>
                                                    <XCircleIcon className={'h-4 w-4'} />
                                                    Disabled
                                                </span>
                                            )}
                                        </div>
                                        {health.rate_limit && (
                                            <div className={'flex flex-col gap-1'}>
                                                <div className={'flex justify-between text-xs text-neutral-400'}>
                                                    <span>Rate limit</span>
                                                    <span>
                                                        {health.rate_limit.requests_this_minute}/
                                                        {health.rate_limit.limit_per_minute} rpm
                                                    </span>
                                                </div>
                                                <div className={'h-1 w-full overflow-hidden rounded-full bg-neutral-700'}>
                                                    <div
                                                        className={'h-full rounded-full'}
                                                        style={{
                                                            width: `${Math.min(100, (health.rate_limit.requests_this_minute / health.rate_limit.limit_per_minute) * 100)}%`,
                                                            backgroundColor: colors.primary,
                                                        }}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                        {hasDenials && (
                                            <div className={'flex items-center gap-1.5 text-xs text-amber-400'}>
                                                <ExclamationCircleIcon className={'h-3.5 w-3.5'} />
                                                {health.denied_by_policy} denied by policy
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </AdminBox>
                )}
            </div>

            {/* Right column */}
            <div className={'flex flex-col gap-4'}>
                <AdminBox title={'Access Control'} icon={ShieldCheckIcon}>
                    <p className={'text-sm text-neutral-400'}>
                        All providers are <strong className={'text-neutral-300'}>denied by default</strong>. You must
                        explicitly enable each provider and assign it to nests or eggs.
                    </p>
                    <div className={'mt-3'}>
                        <Link to={'/admin/marketplace/access-control'}>
                            <Button className={'w-full'}>Configure Access Control</Button>
                        </Link>
                    </div>
                </AdminBox>

                <AdminBox title={'Settings'} icon={CogIcon}>
                    <p className={'text-sm text-neutral-400'}>
                        Configure providers, set your default content source, and manage marketplace settings.
                    </p>
                    <div className={'mt-3'}>
                        <Link to={'/admin/marketplace/settings'}>
                            <Button.Text className={'w-full'}>Go to Settings</Button.Text>
                        </Link>
                    </div>
                </AdminBox>
            </div>
        </div>
    );
}

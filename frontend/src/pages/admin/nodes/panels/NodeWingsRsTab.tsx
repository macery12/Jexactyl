import { m } from '@/i18n';
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
    Zap,
    Rocket,
    Cpu,
    MemoryStick,
    HardDrive,
    ArrowDown,
    ArrowUp,
    ScrollText,
    Info,
    CheckCircle2,
    Circle,
} from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { Meter } from '@/components/ui/Meter';
import { Spinner } from '@/components/ui/Spinner';
import { useNode } from '../NodeContext';
import {
    detectWingsRs,
    getWingsRsOverview,
    getWingsRsStats,
    getWingsRsLogs,
    getWingsRsLogContents,
} from '@/api/wingsRs';
import { formatBytes, formatUptime, timeAgo } from '@/lib/format';

const rate = (bps: number) => `${formatBytes(bps)}/s`;

function Row({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div className="flex items-center justify-between gap-4 border-b border-[var(--color-border)] py-2 last:border-0">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">{label}</span>
            <span className="truncate font-mono text-xs tabular-nums text-[var(--color-ink)]">{value}</span>
        </div>
    );
}

function StatCell({ icon: Icon, label, value, sub }: { icon: typeof Cpu; label: string; value: string; sub?: string }) {
    return (
        <div className="flex flex-col gap-1.5 rounded-sm border border-[var(--color-border)] bg-[var(--color-surface-2)]/40 p-3">
            <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-faint)]">
                <Icon className="h-3 w-3" /> {label}
            </span>
            <span className="font-mono text-base leading-none tabular-nums text-[var(--color-ink)]">{value}</span>
            {sub && <span className="font-mono text-[11px] tabular-nums text-[var(--color-ink-faint)]">{sub}</span>}
        </div>
    );
}

function DetectState({ supercharged, onDetect, detecting }: { supercharged: boolean; onDetect: () => void; detecting: boolean }) {
    const node = useNode();
    return (
        <Panel
            title={m['admin.nodes.wingsRs.integration']()}
            icon={Zap}
            right={
                <button
                    onClick={onDetect}
                    disabled={detecting}
                    className="inline-flex items-center gap-1.5 rounded-sm border border-[var(--color-border-strong)] px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-2)] disabled:opacity-40"
                >
                    <Rocket className="h-3 w-3" /> {detecting ? m['admin.nodes.wingsRs.detecting']() : m['admin.nodes.wingsRs.redetect']()}
                </button>
            }
        >
            <div className="flex items-center gap-2.5 py-1">
                {supercharged ? (
                    <CheckCircle2 className="h-5 w-5 text-[var(--color-accent)]" />
                ) : (
                    <Circle className="h-5 w-5 text-[var(--color-ink-faint)]" />
                )}
                <div>
                    <p className="text-sm text-[var(--color-ink)]">
                        {supercharged ? m['admin.nodes.wingsRs.runningRs']() : m['admin.nodes.wingsRs.runningStandard']()}
                    </p>
                    <p className="font-mono text-[11px] text-[var(--color-ink-faint)]">
                        {supercharged
                            ? `${node.wingsVersion ?? m['admin.nodes.wingsRs.unknownVersion']()}${node.wingsDetectedAt ? ` · ${m['admin.nodes.wingsRs.detectedAgo']({ ago: timeAgo(node.wingsDetectedAt) })}` : ''}`
                            : m['admin.nodes.wingsRs.lockedHint']()}
                    </p>
                </div>
            </div>
        </Panel>
    );
}

export function NodeWingsRsTab() {
    const node = useNode();
    const queryClient = useQueryClient();
    const supercharged = node.wingsType === 'wings-rs';

    const detect = useMutation({
        mutationFn: () => detectWingsRs(node.id),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'node', node.id] }),
    });

    const { data: overview } = useQuery({
        queryKey: ['admin', 'wingsrs-overview', node.id],
        queryFn: () => getWingsRsOverview(node.id),
        enabled: supercharged,
        retry: false,
    });

    const { data: stats, isError: statsError } = useQuery({
        queryKey: ['admin', 'wingsrs-stats', node.id],
        queryFn: () => getWingsRsStats(node.id),
        enabled: supercharged,
        refetchInterval: 2500,
        retry: false,
    });

    const { data: logs } = useQuery({
        queryKey: ['admin', 'wingsrs-logs', node.id],
        queryFn: () => getWingsRsLogs(node.id),
        enabled: supercharged,
        retry: false,
    });

    const [activeLog, setActiveLog] = useState<string | null>(null);
    useEffect(() => {
        if (!activeLog && logs && logs.length > 0) setActiveLog(logs[0]!.name);
    }, [logs, activeLog]);

    const { data: logContent, isFetching: logFetching } = useQuery({
        queryKey: ['admin', 'wingsrs-log', node.id, activeLog],
        queryFn: () => getWingsRsLogContents(node.id, activeLog!),
        enabled: supercharged && !!activeLog,
        retry: false,
    });

    return (
        <div className="flex flex-col gap-4">
            <DetectState supercharged={supercharged} onDetect={() => detect.mutate()} detecting={detect.isPending} />

            {!supercharged ? (
                <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)]/40 px-6 py-14 text-center">
                    <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--color-surface-2)]">
                        <Zap className="h-5 w-5 text-[var(--color-ink-faint)]" />
                    </div>
                    <h3 className="text-base font-medium">{m['admin.nodes.wingsRs.lockedTitle']()}</h3>
                    <p className="mt-1 max-w-md text-sm text-[var(--color-ink-muted)]">
                        {m['admin.nodes.wingsRs.lockedBody']()}
                    </p>
                </div>
            ) : (
                <>
                    <div className="grid gap-4 lg:grid-cols-3">
                        <div className="lg:col-span-2">
                            <Panel
                                title={m['admin.nodes.wingsRs.liveStats']()}
                                icon={Cpu}
                                right={
                                    <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)]">
                                        <span className={`h-1.5 w-1.5 rounded-full ${statsError ? 'bg-[var(--color-danger)]' : 'bg-[var(--color-accent)]'}`} />
                                        {statsError ? m['admin.nodes.overview.unreachable']() : m['admin.nodes.overview.live']()}
                                    </span>
                                }
                            >
                                {!stats ? (
                                    <div className="py-6 text-sm text-[var(--color-ink-faint)]">
                                        {statsError ? m['admin.nodes.wingsRs.daemonUnreachable']() : m['admin.nodes.wingsRs.connecting']()}
                                    </div>
                                ) : (
                                    <div className="flex flex-col gap-4">
                                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                            <StatCell icon={Cpu} label={m['common.metrics.cpu']()} value={`${stats.cpu.used.toFixed(1)}%`} sub={m['admin.nodes.wingsRs.threads']({ count: stats.cpu.threads })} />
                                            <StatCell icon={MemoryStick} label={m['common.metrics.memory']()} value={formatBytes(stats.memory.used)} sub={m['admin.nodes.wingsRs.ofSize']({ size: formatBytes(stats.memory.total) })} />
                                            <StatCell icon={ArrowDown} label={m['admin.nodes.wingsRs.netIn']()} value={rate(stats.network.receivedRate)} />
                                            <StatCell icon={ArrowUp} label={m['admin.nodes.wingsRs.netOut']()} value={rate(stats.network.sentRate)} />
                                        </div>
                                        <div className="grid gap-4 sm:grid-cols-2">
                                            <Meter
                                                icon={MemoryStick}
                                                label={m['common.metrics.memory']()}
                                                value={`${formatBytes(stats.memory.used)} / ${formatBytes(stats.memory.total)}`}
                                                percent={stats.memory.total > 0 ? (stats.memory.used / stats.memory.total) * 100 : null}
                                            />
                                            <Meter
                                                icon={HardDrive}
                                                label={m['common.metrics.disk']()}
                                                value={`${formatBytes(stats.disk.used)} / ${formatBytes(stats.disk.total)}`}
                                                percent={stats.disk.total > 0 ? (stats.disk.used / stats.disk.total) * 100 : null}
                                            />
                                        </div>
                                        <p className="font-mono text-[11px] text-[var(--color-ink-faint)]">
                                            {stats.cpu.model} · disk r {rate(stats.disk.readRate)} / w {rate(stats.disk.writeRate)}
                                        </p>
                                    </div>
                                )}
                            </Panel>
                        </div>

                        <Panel title={m['admin.nodes.wingsRs.overview']()} icon={Info}>
                            {!overview ? (
                                <div className="py-6 text-sm text-[var(--color-ink-faint)]">{m['common.states.loading']()}</div>
                            ) : (
                                <div className="flex flex-col">
                                    <Row label={m['admin.nodes.wingsRs.version']()} value={overview.version} />
                                    <Row label={m['admin.nodes.wingsRs.rust']()} value={overview.rustVersion ?? '—'} />
                                    <Row label={m['admin.nodes.wingsRs.build']()} value={overview.buildDate ?? '—'} />
                                    <Row label={m['admin.nodes.wingsRs.kernel']()} value={overview.kernel} />
                                    <Row label={m['admin.nodes.wingsRs.uptime']()} value={overview.uptime != null ? formatUptime(overview.uptime * 1000) : '—'} />
                                    <Row
                                        label={m['admin.nodes.wingsRs.features']()}
                                        value={overview.features.length > 0 ? m['admin.nodes.wingsRs.featuresEnabled']({ count: overview.features.length }) : '—'}
                                    />
                                </div>
                            )}
                        </Panel>
                    </div>

                    <Panel
                        title={m['admin.nodes.wingsRs.systemLogs']()}
                        icon={ScrollText}
                        right={
                            logs && logs.length > 0 ? (
                                <select
                                    value={activeLog ?? ''}
                                    onChange={e => setActiveLog(e.target.value)}
                                    className="rounded-sm border border-[var(--color-border-strong)] bg-[var(--color-surface-2)] px-2 py-0.5 font-mono text-[11px] text-[var(--color-ink-muted)] outline-none"
                                >
                                    {logs.map(l => (
                                        <option key={l.name} value={l.name}>
                                            {l.name}
                                        </option>
                                    ))}
                                </select>
                            ) : undefined
                        }
                        flush
                    >
                        {!logs || logs.length === 0 ? (
                            <p className="p-4 text-sm text-[var(--color-ink-faint)]">{m['admin.nodes.wingsRs.noLogs']()}</p>
                        ) : logFetching && !logContent ? (
                            <div className="flex justify-center py-8">
                                <Spinner className="h-5 w-5" />
                            </div>
                        ) : (
                            <pre className="max-h-96 overflow-auto rounded-b-md bg-[#08080c] p-4 font-mono text-xs leading-relaxed text-[var(--color-ink-muted)]">
                                {(logContent ?? []).join('\n') || m['admin.nodes.wingsRs.empty']()}
                            </pre>
                        )}
                    </Panel>
                </>
            )}
        </div>
    );
}

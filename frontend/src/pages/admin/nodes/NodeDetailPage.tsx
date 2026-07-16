import { m, td } from '@/i18n';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, Network, Layers, FileCog, Zap } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { getNode } from '@/api/nodes';
import { NodeContext } from './NodeContext';
import { NodeHeader } from './NodeHeader';
import { NodeOverviewTab } from './panels/NodeOverviewTab';
import { NodeAllocationsTab } from './panels/NodeAllocationsTab';
import { NodeServersTab } from './panels/NodeServersTab';
import { NodeConfigurationTab } from './panels/NodeConfigurationTab';
import { NodeWingsRsTab } from './panels/NodeWingsRsTab';
import { Spinner } from '@/components/ui/Spinner';
import { cn } from '@/lib/cn';

type TabId = 'overview' | 'allocations' | 'servers' | 'configuration' | 'wings-rs';

const TABS: { id: TabId; labelKey: string; icon: LucideIcon; supercharged?: boolean }[] = [
    { id: 'overview', labelKey: 'nodes.tabs.overview', icon: Activity },
    { id: 'allocations', labelKey: 'nodes.tabs.allocations', icon: Network },
    { id: 'servers', labelKey: 'nodes.tabs.servers', icon: Layers },
    { id: 'configuration', labelKey: 'nodes.tabs.configuration', icon: FileCog },
    { id: 'wings-rs', labelKey: 'nodes.tabs.wingsRs', icon: Zap, supercharged: true },
];

export default function NodeDetailPage() {
    const { id } = useParams();
    const [tab, setTab] = useState<TabId>('overview');

    const { data: node, isLoading, isError } = useQuery({
        queryKey: ['admin', 'node', id],
        queryFn: () => getNode(id!),
        enabled: !!id,
    });

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-24">
                <Spinner className="h-7 w-7" />
            </div>
        );
    }

    if (isError || !node) {
        return (
            <div className="rounded-md border border-[var(--color-danger)]/40 bg-[var(--color-danger)]/10 px-5 py-4 text-sm text-[var(--color-danger)]">
                {m['admin.nodes.detailLoadError']()}
            </div>
        );
    }

    return (
        <NodeContext.Provider value={node}>
            <div className="flex flex-col gap-5">
                <NodeHeader />

                <div className="flex gap-1 overflow-x-auto border-b border-[var(--color-border)]">
                    {TABS.map(tabDef => {
                        const isWingsRs = tabDef.supercharged;
                        return (
                            <button
                                key={tabDef.id}
                                onClick={() => setTab(tabDef.id)}
                                className={cn(
                                    'flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-xs font-semibold uppercase tracking-wider transition-colors',
                                    tab === tabDef.id
                                        ? 'border-[var(--color-accent)] text-[var(--color-ink)]'
                                        : 'border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
                                    isWingsRs && node.wingsType === 'wings-rs' && tab !== tabDef.id && 'text-[var(--color-accent)]/80',
                                )}
                            >
                                <tabDef.icon className="h-3.5 w-3.5" />
                                {td(`admin.${tabDef.labelKey}`)}
                            </button>
                        );
                    })}
                </div>

                <div>
                    {tab === 'overview' && <NodeOverviewTab />}
                    {tab === 'allocations' && <NodeAllocationsTab />}
                    {tab === 'servers' && <NodeServersTab />}
                    {tab === 'configuration' && <NodeConfigurationTab />}
                    {tab === 'wings-rs' && <NodeWingsRsTab />}
                </div>
            </div>
        </NodeContext.Provider>
    );
}

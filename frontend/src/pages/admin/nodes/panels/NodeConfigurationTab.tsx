import { m } from '@/i18n';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileCog, Copy, Check } from 'lucide-react';
import { Panel } from '@/components/ui/Panel';
import { useNode } from '../NodeContext';
import { getNodeConfiguration } from '@/api/nodes';
import { Spinner } from '@/components/ui/Spinner';

export function NodeConfigurationTab() {
    const node = useNode();
    const [copied, setCopied] = useState(false);
    const { data: config, isLoading, isError } = useQuery({
        queryKey: ['admin', 'node-configuration', node.id],
        queryFn: () => getNodeConfiguration(node.id),
        retry: false,
    });

    const copy = () => {
        if (!config) return;
        navigator.clipboard?.writeText(config).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    };

    return (
        <Panel
            title={m['admin.nodes.configTab.title']()}
            icon={FileCog}
            right={
                config ? (
                    <button
                        onClick={copy}
                        className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
                    >
                        {copied ? <Check className="h-3 w-3 text-[var(--color-accent)]" /> : <Copy className="h-3 w-3" />}
                        {copied ? m['admin.nodes.configTab.copied']() : m['admin.nodes.configTab.copy']()}
                    </button>
                ) : undefined
            }
            flush
        >
            {isLoading ? (
                <div className="flex justify-center py-10">
                    <Spinner className="h-6 w-6" />
                </div>
            ) : isError || !config ? (
                <p className="p-4 text-sm text-[var(--color-ink-faint)]">{m['admin.nodes.configTab.loadError']()}</p>
            ) : (
                <pre className="max-h-[32rem] overflow-auto rounded-b-md bg-[#08080c] p-4 font-mono text-xs leading-relaxed text-[var(--color-ink-muted)]">
                    {config}
                </pre>
            )}
        </Panel>
    );
}

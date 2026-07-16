import { m } from '@/i18n';
import { useState } from 'react';
import { Network, Star, Copy, Check } from 'lucide-react';
import { Panel } from './Panel';
import { useServer } from '@/components/server/ServerContext';
import { cn } from '@/lib/cn';

function CopyRow({ value, primary, starred }: { value: string; primary?: boolean; starred?: boolean }) {
    const [copied, setCopied] = useState(false);
    const copy = () =>
        navigator.clipboard?.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    return (
        <button
            onClick={copy}
            className={cn(
                'group flex w-full items-center gap-2 rounded-sm border px-2.5 py-2 text-left text-sm transition-colors',
                primary
                    ? 'border-[var(--brand)]/40 bg-[var(--brand)]/8'
                    : 'border-[var(--color-border)] hover:bg-[var(--color-surface-2)]',
            )}
        >
            {starred && <Star className="h-3 w-3 shrink-0 fill-[var(--color-warning)] text-[var(--color-warning)]" />}
            <span className="min-w-0 flex-1 truncate font-mono text-xs tabular-nums text-[var(--color-ink)]">{value}</span>
            {copied ? (
                <Check className="h-3.5 w-3.5 shrink-0 text-[var(--color-accent)]" />
            ) : (
                <Copy className="h-3.5 w-3.5 shrink-0 text-[var(--color-ink-faint)] opacity-0 transition-opacity group-hover:opacity-100" />
            )}
        </button>
    );
}

export function NetworkPanel() {
    const server = useServer();
    const sftp = server.sftp.ip ? `sftp://${server.sftp.ip}:${server.sftp.port}` : null;
    const allocations = server.allocations
        .slice()
        .sort((a, b) => Number(b.isDefault) - Number(a.isDefault));

    return (
        <Panel title={m['server.network.title']()} icon={Network}>
            <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
                        {m['server.network.allocations']()}
                    </span>
                    {allocations.length === 0 && (
                        <p className="text-xs text-[var(--color-ink-faint)]">{m['server.network.noAllocations']()}</p>
                    )}
                    {allocations.map(a => (
                        <CopyRow key={a.id} value={`${a.alias || a.ip}:${a.port}`} primary={a.isDefault} starred={a.isDefault} />
                    ))}
                </div>
                {sftp && (
                    <div className="flex flex-col gap-1.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-ink-faint)]">
                            {m['server.network.sftp']()}
                        </span>
                        <CopyRow value={sftp} />
                    </div>
                )}
            </div>
        </Panel>
    );
}

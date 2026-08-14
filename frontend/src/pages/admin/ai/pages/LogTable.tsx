import { Check, X, Zap } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import { Spinner } from '@/components/ui/Spinner';
import type { AiLogEntry } from '@/api/adminAi';
import { sourceChip, sourceLabel, sourceTone } from '../sources';

// Shared request-log table used by the overview (recent 10) and the Logs tab
// (filtered, up to 500). Cached responses carry a lightning badge — they cost
// no tokens and return near-instantly.
export function LogTable({ logs, loading }: { logs: AiLogEntry[]; loading: boolean }) {
    if (loading) {
        return (
            <div className="flex justify-center py-8">
                <Spinner className="h-5 w-5" />
            </div>
        );
    }

    if (logs.length === 0) {
        return <p className="px-4 py-8 text-center text-xs text-[var(--color-ink-faint)]">{m['admin.ai.logs.empty']()}</p>;
    }

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-xs">
                <thead>
                    <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-ink-faint)]">
                        <th className="px-3 py-2 font-normal">{m['admin.ai.logs.time']()}</th>
                        <th className="px-3 py-2 font-normal">{m['admin.ai.logs.user']()}</th>
                        <th className="px-3 py-2 font-normal">{m['admin.ai.logs.server']()}</th>
                        <th className="px-3 py-2 font-normal">{m['admin.ai.logs.model']()}</th>
                        <th className="px-3 py-2 font-normal">{m['admin.ai.logs.source']()}</th>
                        <th className="px-3 py-2 font-normal">{m['admin.ai.logs.tokens']()}</th>
                        <th className="px-3 py-2 font-normal">{m['admin.ai.logs.latency']()}</th>
                        <th className="px-3 py-2 font-normal">{m['admin.ai.logs.status']()}</th>
                    </tr>
                </thead>
                <tbody>
                    {logs.map(log => (
                        <tr
                            key={log.id}
                            className="border-b border-[var(--color-border)]/40 last:border-0 hover:bg-[var(--color-surface-2)]/50"
                        >
                            <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[var(--color-ink-faint)]">
                                {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                <span className="ml-1.5 opacity-60">
                                    {new Date(log.created_at).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                                </span>
                            </td>
                            <td className="px-3 py-1.5 text-[var(--color-ink)]">{log.username}</td>
                            <td className="max-w-[10rem] truncate px-3 py-1.5 text-[var(--color-ink-muted)]">
                                {log.server_name ?? '—'}
                            </td>
                            <td className="px-3 py-1.5 font-mono text-[var(--color-ink-muted)]">{log.model}</td>
                            <td className="px-3 py-1.5">
                                <span
                                    className={cn(
                                        'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                                        sourceChip[sourceTone(log.source)],
                                    )}
                                >
                                    {sourceLabel(log.source)}
                                </span>
                            </td>
                            <td className="px-3 py-1.5 font-mono tabular-nums text-[var(--color-ink-muted)]">
                                {log.total_tokens ?? '—'}
                            </td>
                            <td className="whitespace-nowrap px-3 py-1.5 font-mono tabular-nums text-[var(--color-ink-muted)]">
                                {log.latency_ms != null ? `${log.latency_ms}ms` : '—'}
                                {log.cached && (
                                    <span
                                        title={m['admin.ai.logs.cachedHint']()}
                                        className="ml-1.5 inline-flex items-center gap-0.5 rounded bg-[var(--color-accent)]/15 px-1 py-0.5 text-[10px] font-semibold text-[var(--color-accent)]"
                                    >
                                        <Zap className="h-2.5 w-2.5" />
                                        {m['admin.ai.logs.cached']()}
                                    </span>
                                )}
                            </td>
                            <td className="px-3 py-1.5">
                                {log.status === 'success' ? (
                                    <Check className="h-3.5 w-3.5 text-[var(--color-accent)]" />
                                ) : (
                                    <span title={log.error_message ?? undefined}>
                                        <X className="h-3.5 w-3.5 text-[var(--color-danger)]" />
                                    </span>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

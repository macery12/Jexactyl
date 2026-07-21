import { m } from '@/i18n';
import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Filter, ChevronLeft, ChevronRight } from 'lucide-react';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { FullPageSpinner, Spinner } from '@/components/ui/Spinner';
import { getEmailLogs, getTemplateKeys, type EmailLogFilters } from '@/api/email';
import { SettingsCard, StatusChip, LabeledField } from '../parts';
import { EmailLogDetailModal } from './EmailLogDetailModal';

interface Filters {
    status: string;
    template_key: string;
    recipient: string;
    only_failures: boolean;
    date_from: string;
    date_to: string;
    page: number;
}

const EMPTY: Filters = {
    status: '',
    template_key: '',
    recipient: '',
    only_failures: false,
    date_from: '',
    date_to: '',
    page: 1,
};

// Activity log: a filterable, paginated table of every send attempt with a
// per-row detail modal.
export default function ActivityPage() {
    const [filters, setFilters] = useState<Filters>(EMPTY);
    const [recipientInput, setRecipientInput] = useState('');
    const [showFilters, setShowFilters] = useState(true);
    const [selected, setSelected] = useState<number | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const templatesQ = useQuery({ queryKey: ['admin', 'email', 'templateKeys'], queryFn: getTemplateKeys });

    const apiFilters: EmailLogFilters = {
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.template_key ? { template_key: filters.template_key } : {}),
        ...(filters.recipient ? { recipient: filters.recipient } : {}),
        ...(filters.only_failures ? { only_failures: true } : {}),
        ...(filters.date_from ? { date_from: filters.date_from } : {}),
        ...(filters.date_to ? { date_to: filters.date_to } : {}),
        page: filters.page,
    };

    const logsQ = useQuery({
        queryKey: ['admin', 'email', 'logs', apiFilters],
        queryFn: () => getEmailLogs(apiFilters),
    });

    useEffect(() => () => void (debounceRef.current && clearTimeout(debounceRef.current)), []);

    const set = (patch: Partial<Filters>) =>
        setFilters(f => ({ ...f, ...patch, page: 'page' in patch ? (patch.page as number) : 1 }));

    const onRecipient = (value: string) => {
        setRecipientInput(value);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => set({ recipient: value }), 600);
    };

    const quickRange = (days: number) => {
        const now = new Date();
        const from = new Date(now.getTime() - days * 86_400_000);
        set({ date_from: from.toISOString().split('T')[0] ?? '', date_to: now.toISOString().split('T')[0] ?? '' });
    };

    const clearAll = () => {
        setFilters(EMPTY);
        setRecipientInput('');
    };

    const statusOptions = [
        { value: '', label: m['admin.email.activity.allStatuses']() },
        { value: 'queued', label: m['admin.email.status.queued']() },
        { value: 'sending', label: m['admin.email.status.sending']() },
        { value: 'deferred', label: m['admin.email.status.deferred']() },
        { value: 'skipped', label: m['admin.email.status.skipped']() },
        { value: 'sent', label: m['admin.email.status.sent']() },
        { value: 'failed', label: m['admin.email.status.failed']() },
    ];
    const templateOptions = [
        { value: '', label: m['admin.email.activity.allTemplates']() },
        ...(templatesQ.data?.template_keys ?? []).map(k => ({ value: k, label: k })),
    ];

    const logs = logsQ.data;

    return (
        <div className="flex flex-col gap-5">
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-lg font-semibold text-[var(--color-ink)]">{m['admin.email.activity.title']()}</h2>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.email.activity.desc']()}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => setShowFilters(s => !s)}>
                    <Filter className="h-4 w-4" />
                    {showFilters ? m['admin.email.activity.hideFilters']() : m['admin.email.activity.showFilters']()}
                </Button>
            </div>

            {showFilters && (
                <SettingsCard
                    title={m['admin.email.activity.filters']()}
                    right={
                        <Button variant="ghost" size="sm" onClick={clearAll}>
                            {m['admin.email.activity.clearAll']()}
                        </Button>
                    }
                >
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                        <LabeledField label={m['admin.email.activity.status']()}>
                            <Select value={filters.status} onChange={v => set({ status: v })} options={statusOptions} />
                        </LabeledField>
                        <LabeledField label={m['admin.email.activity.template']()}>
                            <Select
                                value={filters.template_key}
                                onChange={v => set({ template_key: v })}
                                options={templateOptions}
                            />
                        </LabeledField>
                        <LabeledField label={m['admin.email.activity.recipient']()}>
                            <Input
                                value={recipientInput}
                                onChange={e => onRecipient(e.target.value)}
                                placeholder={m['admin.email.activity.recipientPlaceholder']()}
                            />
                        </LabeledField>
                        <LabeledField label={m['admin.email.activity.dateFrom']()}>
                            <Input type="date" value={filters.date_from} onChange={e => set({ date_from: e.target.value })} />
                        </LabeledField>
                        <LabeledField label={m['admin.email.activity.dateTo']()}>
                            <Input type="date" value={filters.date_to} onChange={e => set({ date_to: e.target.value })} />
                        </LabeledField>
                        <LabeledField label={m['admin.email.activity.quickRange']()}>
                            <div className="flex gap-2">
                                <Button variant="secondary" size="sm" onClick={() => quickRange(1)}>24h</Button>
                                <Button variant="secondary" size="sm" onClick={() => quickRange(7)}>7d</Button>
                                <Button variant="secondary" size="sm" onClick={() => quickRange(30)}>30d</Button>
                            </div>
                        </LabeledField>
                    </div>
                    <label className="mt-4 flex w-fit items-center gap-2 text-sm text-[var(--color-ink-muted)]">
                        <Switch
                            checked={filters.only_failures}
                            onChange={v => set({ only_failures: v })}
                            label={m['admin.email.activity.onlyFailures']()}
                        />
                        {m['admin.email.activity.onlyFailures']()}
                    </label>
                </SettingsCard>
            )}

            {logsQ.isLoading ? (
                <FullPageSpinner />
            ) : !logs || logs.data.length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 rounded-[var(--radius-card)] border border-dashed border-[var(--color-border-strong)] bg-[var(--color-surface)]/40 px-6 py-16 text-center">
                    <p className="text-sm font-medium text-[var(--color-ink)]">{m['admin.email.activity.emptyTitle']()}</p>
                    <p className="text-xs text-[var(--color-ink-muted)]">{m['admin.email.activity.emptyBody']()}</p>
                </div>
            ) : (
                <div className="overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]/60">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b border-[var(--color-border)] text-left text-[11px] uppercase tracking-wide text-[var(--color-ink-faint)]">
                                <Th>{m['admin.email.activity.colStatus']()}</Th>
                                <Th>{m['admin.email.activity.colTime']()}</Th>
                                <Th>{m['admin.email.activity.colRecipient']()}</Th>
                                <Th>{m['admin.email.activity.colTemplate']()}</Th>
                                <Th>{m['admin.email.activity.colProvider']()}</Th>
                                <Th>{m['admin.email.activity.colAttempts']()}</Th>
                                <Th> </Th>
                            </tr>
                        </thead>
                        <tbody>
                            {logs.data.map(log => (
                                <tr key={log.id} className="border-b border-[var(--color-border)] last:border-0 hover:bg-[var(--color-surface-2)]/40">
                                    <Td><StatusChip status={log.status} /></Td>
                                    <Td className="whitespace-nowrap text-[var(--color-ink-muted)]">
                                        {new Date(log.created_at).toLocaleString()}
                                    </Td>
                                    <Td>
                                        <span className="text-[var(--color-ink)]">{log.to}</span>
                                        {log.user && (
                                            <span className="ml-1.5 text-xs text-[var(--color-ink-faint)]">@{log.user.username}</span>
                                        )}
                                    </Td>
                                    <Td>
                                        <code className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--color-ink-muted)]">
                                            {log.template_key || m['admin.email.activity.custom']()}
                                        </code>
                                    </Td>
                                    <Td className="uppercase text-[var(--color-ink-muted)]">{log.provider || '—'}</Td>
                                    <Td className={log.attempt_count > 1 ? 'text-[var(--color-warning)]' : 'text-[var(--color-ink-muted)]'}>
                                        {log.attempt_count}
                                    </Td>
                                    <Td>
                                        <Button variant="ghost" size="sm" onClick={() => setSelected(log.id)}>
                                            {m['admin.email.activity.view']()}
                                        </Button>
                                    </Td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {logs && logs.last_page > 1 && (
                <div className="flex items-center justify-center gap-3">
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => set({ page: filters.page - 1 })}
                        disabled={filters.page <= 1}
                    >
                        <ChevronLeft className="h-4 w-4" /> {m['admin.email.activity.prev']()}
                    </Button>
                    <span className="text-sm text-[var(--color-ink-muted)]">
                        {logsQ.isFetching ? (
                            <Spinner className="h-4 w-4" />
                        ) : (
                            m['admin.email.activity.pageOf']({ current: logs.current_page, total: logs.last_page })
                        )}
                    </span>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => set({ page: filters.page + 1 })}
                        disabled={filters.page >= logs.last_page}
                    >
                        {m['admin.email.activity.next']()} <ChevronRight className="h-4 w-4" />
                    </Button>
                </div>
            )}

            {selected !== null && <EmailLogDetailModal logId={selected} onClose={() => setSelected(null)} />}
        </div>
    );
}

function Th({ children }: { children: React.ReactNode }) {
    return <th className="px-4 py-3 font-semibold">{children}</th>;
}
function Td({ children, className }: { children: React.ReactNode; className?: string }) {
    return <td className={`px-4 py-3 align-middle ${className ?? ''}`}>{children}</td>;
}

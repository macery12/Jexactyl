import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Bot, ListOrdered, MessagesSquare, Settings2, TriangleAlert } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { m } from '@/i18n';
import { cn } from '@/lib/cn';
import { Spinner } from '@/components/ui/Spinner';
import { getAiSettings } from '@/api/adminAi';
import { OverviewTab } from './OverviewTab';
import { PlaygroundTab } from './PlaygroundTab';
import { LogsTab } from './LogsTab';
import { SettingsTab } from './SettingsTab';

// Admin AI (M12Labs-AI) — tabbed cockpit over /api/application/ai/*.
// Overview = health + usage analytics; Playground = admin chat console;
// Logs = full request log with filters; Settings = provider configuration.
// Module on/off lives in Admin → Features (the V1 EnableAI screen is gone);
// an unconfigured provider surfaces as a banner steering to Settings.

export type AiTabId = 'overview' | 'playground' | 'logs' | 'settings';

const TABS: { id: AiTabId; labelKey: () => string; icon: LucideIcon }[] = [
    { id: 'overview', labelKey: () => m['admin.ai.tabs.overview'](), icon: Activity },
    { id: 'playground', labelKey: () => m['admin.ai.tabs.playground'](), icon: MessagesSquare },
    { id: 'logs', labelKey: () => m['admin.ai.tabs.logs'](), icon: ListOrdered },
    { id: 'settings', labelKey: () => m['admin.ai.tabs.settings'](), icon: Settings2 },
];

export default function AiSection() {
    const [tab, setTab] = useState<AiTabId>('overview');

    const { data: settings, isLoading } = useQuery({
        queryKey: ['admin', 'ai', 'settings'],
        queryFn: getAiSettings,
    });

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-24">
                <Spinner className="h-7 w-7" />
            </div>
        );
    }

    // Ollama needs endpoint+model; OpenAI additionally needs a stored key.
    const needsConfiguration = settings
        ? settings.mode === 'ollama'
            ? !settings.endpoint || !settings.model
            : !settings.key || !settings.endpoint || !settings.model
        : false;

    return (
        <div className="space-y-4">
            <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--brand)]/12 text-[var(--brand)]">
                    <Bot className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                    <h2 className="text-base font-semibold text-[var(--color-ink)]">{m['admin.ai.title']()}</h2>
                    <p className="text-sm text-[var(--color-ink-muted)]">{m['admin.ai.subtitle']()}</p>
                </div>
            </div>

            {needsConfiguration && tab !== 'settings' && (
                <button
                    type="button"
                    onClick={() => setTab('settings')}
                    className="flex w-full items-center gap-3 rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-4 py-3 text-left transition-colors hover:bg-[var(--color-warning)]/15"
                >
                    <TriangleAlert className="h-4 w-4 shrink-0 text-[var(--color-warning)]" />
                    <span className="text-sm text-[var(--color-ink)]">{m['admin.ai.needsConfiguration']()}</span>
                </button>
            )}

            <div className="flex flex-wrap items-center gap-1 border-b border-[var(--color-border)]">
                {TABS.map(def => (
                    <button
                        key={def.id}
                        type="button"
                        onClick={() => setTab(def.id)}
                        className={cn(
                            'flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors',
                            tab === def.id
                                ? 'border-[var(--brand)] font-medium text-[var(--color-ink)]'
                                : 'border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]',
                        )}
                    >
                        <def.icon className="h-3.5 w-3.5" />
                        {def.labelKey()}
                    </button>
                ))}
            </div>

            {tab === 'overview' && <OverviewTab onViewLogs={() => setTab('logs')} />}
            {tab === 'playground' && <PlaygroundTab />}
            {tab === 'logs' && <LogsTab />}
            {tab === 'settings' && <SettingsTab />}
        </div>
    );
}

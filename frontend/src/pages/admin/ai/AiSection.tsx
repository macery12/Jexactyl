import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { TriangleAlert } from 'lucide-react';
import { m } from '@/i18n/messages';
import { Spinner } from '@/components/ui/Spinner';
import { SELF_HOSTED_PROVIDERS } from '@/api/adminAi';
import { AiNav } from './AiNav';
import { AiLoadError } from './LoadError';
import { useAiSettings } from './useAiSettingsForm';

const OverviewPage = lazy(() => import('./pages/OverviewPage'));
const ProviderPage = lazy(() => import('./pages/ProviderPage'));
const GenerationPage = lazy(() => import('./pages/GenerationPage'));
const AgentPage = lazy(() => import('./pages/AgentPage'));
const ToolsPage = lazy(() => import('./pages/ToolsPage'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage'));
const PerformancePage = lazy(() => import('./pages/PerformancePage'));
const LimitsPage = lazy(() => import('./pages/LimitsPage'));
const LogsPage = lazy(() => import('./pages/LogsPage'));

// Admin AI (M12Labs-AI) — mounted at the admin `ai/*` splat.
//
// Was a single page with a useState tab strip and one 910-line settings form.
// Both problems were the same problem: nothing had an address. A tab could not
// be linked, browser-back left the section entirely, and every setting shared
// one save button whether or not the configured provider honoured it. Each rail
// item is now a route with its own slice of the settings document and its own
// save, mirroring the email section.
//
// The assistant itself is not here. It lived as a tab for exactly one release,
// which buried a conversation you return to daily inside a section that is
// otherwise configuration — it has its own page at the top of the sidebar now.
// Module on/off lives in Admin → Features; an unconfigured provider surfaces as
// a banner steering to Provider.
export default function AiSection() {
    const { data: settings, isLoading, isError, refetch } = useAiSettings();
    const { pathname } = useLocation();

    if (isLoading) {
        return (
            <div className="flex items-center justify-center py-24">
                <Spinner className="h-7 w-7" />
            </div>
        );
    }

    if (isError) {
        return (
            <div>
                <header>
                    <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
                        {m['admin.ai.title']()}
                    </h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.ai.subtitle']()}</p>
                </header>
                <AiLoadError onRetry={() => void refetch()} />
            </div>
        );
    }

    // Self-hosted endpoints need only a URL and a model; hosted providers also
    // need a stored key before anything will answer.
    const needsConfiguration = settings
        ? SELF_HOSTED_PROVIDERS.includes(settings.provider)
            ? !settings.endpoint || !settings.model
            : !settings.key || !settings.endpoint || !settings.model
        : false;

    return (
        <div className="flex flex-col gap-6">
            <header>
                <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
                    {m['admin.ai.title']()}
                </h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.ai.subtitle']()}</p>
            </header>

            {/* Not while you are already on the page it points at — a banner
                telling you to go where you are is noise. */}
            {needsConfiguration && pathname !== '/admin/ai/provider' && (
                <Link
                    to="/admin/ai/provider"
                    className="flex items-center gap-3 rounded-lg border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-4 py-3 transition-colors hover:bg-[var(--color-warning)]/15"
                >
                    <TriangleAlert className="h-4 w-4 shrink-0 text-[var(--color-warning)]" />
                    <span className="text-sm text-[var(--color-ink)]">{m['admin.ai.needsConfiguration']()}</span>
                </Link>
            )}

            <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
                <AiNav />
                <div className="min-w-0 flex-1">
                    <Suspense fallback={<div className="flex justify-center py-16"><Spinner className="h-6 w-6" /></div>}>
                        <Routes>
                            <Route index element={<OverviewPage />} />
                            <Route path="provider" element={<ProviderPage />} />
                            <Route path="generation" element={<GenerationPage />} />
                            <Route path="agent" element={<AgentPage />} />
                            <Route path="tools" element={<ToolsPage />} />
                            <Route path="privacy" element={<PrivacyPage />} />
                            <Route path="performance" element={<PerformancePage />} />
                            <Route path="limits" element={<LimitsPage />} />
                            <Route path="logs" element={<LogsPage />} />
                            {/* Catches the retired tab links and anything mistyped. */}
                            <Route path="*" element={<Navigate to="/admin/ai" replace />} />
                        </Routes>
                    </Suspense>
                </div>
            </div>
        </div>
    );
}

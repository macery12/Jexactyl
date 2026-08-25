import { m } from '@/i18n/messages';
import { useState } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { getDeferredQueue } from '@/api/email';
import { EmailNav } from './EmailNav';
import { DeferredQueueModal } from './DeferredQueueModal';
import OverviewPage from './pages/OverviewPage';
import SmtpPage from './pages/SmtpPage';
import ResendPage from './pages/ResendPage';
import TestingPage from './pages/TestingPage';
import NotificationsPage from './pages/NotificationsPage';
import ActivityPage from './pages/ActivityPage';
import TemplatesPage from './pages/TemplatesPage';

export const DEFERRED_QUEUE_KEY = ['admin', 'email', 'deferred'] as const;

// Mounted at the admin `email/*` splat route. Owns the email configuration
// (split into Overview/SMTP/Resend/Testing rail items), notifications, and the
// activity log. The deferred queue is a header button + modal rather than a
// full page (kept deliberately lightweight).
export default function EmailSection() {
    const [deferredOpen, setDeferredOpen] = useState(false);

    // Lightweight count for the header badge; the modal owns the full list.
    const countQ = useQuery({
        queryKey: DEFERRED_QUEUE_KEY,
        queryFn: () => getDeferredQueue(),
        refetchInterval: 60_000,
    });
    const queued = countQ.data?.stats.total_queued ?? 0;

    return (
        <div className="flex flex-col gap-6">
            <header className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
                        {m['admin.email.title']()}
                    </h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.email.subtitle']()}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => setDeferredOpen(true)}>
                    <Clock className="h-4 w-4" />
                    {m['admin.email.deferred.button']()}
                    {queued > 0 && (
                        <span className="ml-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-warning)]/15 px-1.5 text-[11px] font-semibold text-[var(--color-warning)]">
                            {queued}
                        </span>
                    )}
                </Button>
            </header>

            <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
                <EmailNav />
                <div className="min-w-0 flex-1">
                    <Routes>
                        <Route index element={<OverviewPage />} />
                        <Route path="smtp" element={<SmtpPage />} />
                        <Route path="resend" element={<ResendPage />} />
                        <Route path="testing" element={<TestingPage />} />
                        <Route path="notifications" element={<NotificationsPage />} />
                        <Route path="activity" element={<ActivityPage />} />
                        <Route path="templates" element={<TemplatesPage />} />
                    </Routes>
                </div>
            </div>

            <DeferredQueueModal open={deferredOpen} onClose={() => setDeferredOpen(false)} />
        </div>
    );
}

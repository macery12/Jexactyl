import { m } from '@/i18n';
import { Routes, Route } from 'react-router-dom';
import { WebhooksNav } from './WebhooksNav';
import EnableWebhooks from './EnableWebhooks';
import ConfigurationPage from './pages/ConfigurationPage';
import EventsPage from './pages/EventsPage';

// Live view of the webhook module bootstrap. `enabled` gates the whole section;
// `url` is exposed only as a boolean (the backend never ships the raw value to
// the client), mirroring V1's "Configured (hidden)" behaviour.
export function webhookConfig(): { enabled: boolean; urlConfigured: boolean } {
    const cfg = window.EverestConfiguration?.webhooks as
        | { enabled?: boolean; url?: boolean }
        | undefined;
    return { enabled: Boolean(cfg?.enabled), urlConfigured: Boolean(cfg?.url) };
}

// Mounted at the admin `webhooks/*` splat route. When the module is disabled it
// shows a feature-intro gate; once enabled it renders a left-rail section with
// the Configuration and Event Management pages.
export default function WebhooksSection() {
    const { enabled } = webhookConfig();

    if (!enabled) return <EnableWebhooks />;

    return (
        <div className="flex flex-col gap-6">
            <header>
                <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
                    {m['admin.webhooks.title']()}
                </h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.webhooks.subtitle']()}</p>
            </header>

            <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
                <WebhooksNav />
                <div className="min-w-0 flex-1">
                    <Routes>
                        <Route index element={<ConfigurationPage />} />
                        <Route path="events" element={<EventsPage />} />
                    </Routes>
                </div>
            </div>
        </div>
    );
}

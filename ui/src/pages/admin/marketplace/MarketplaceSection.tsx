import { Routes, Route } from 'react-router-dom';
import { m } from '@/i18n';
import { MarketplaceNav } from './MarketplaceNav';
import OverviewPage from './pages/OverviewPage';
import SettingsPage from './pages/SettingsPage';
import ProvidersPage from './pages/ProvidersPage';

// Mounted at the admin `marketplace/*` splat. Owns the three marketplace admin
// surfaces: analytics Overview, global Settings, and per-egg Provider access.
export default function MarketplaceSection() {
    return (
        <div className="flex flex-col gap-6">
            <header>
                <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
                    {m['admin.marketplace.title']()}
                </h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.marketplace.subtitle']()}</p>
            </header>

            <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
                <MarketplaceNav />
                <div className="min-w-0 flex-1">
                    <Routes>
                        <Route index element={<OverviewPage />} />
                        <Route path="settings" element={<SettingsPage />} />
                        <Route path="providers" element={<ProvidersPage />} />
                    </Routes>
                </div>
            </div>
        </div>
    );
}

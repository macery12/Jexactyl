import { Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { m } from '@/i18n/messages';
import { MarketplaceNav } from './MarketplaceNav';
import { Spinner } from '@/components/ui/Spinner';

const OverviewPage = lazy(() => import('./pages/OverviewPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const ProvidersPage = lazy(() => import('./pages/ProvidersPage'));

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
                    <Suspense fallback={<div className="flex justify-center py-16"><Spinner className="h-6 w-6" /></div>}>
                        <Routes>
                            <Route index element={<OverviewPage />} />
                            <Route path="settings" element={<SettingsPage />} />
                            <Route path="providers" element={<ProvidersPage />} />
                        </Routes>
                    </Suspense>
                </div>
            </div>
        </div>
    );
}

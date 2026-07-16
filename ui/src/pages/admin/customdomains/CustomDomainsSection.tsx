import { m } from '@/i18n';
import { Routes, Route } from 'react-router-dom';
import { CustomDomainsNav } from './CustomDomainsNav';
import { AdminCustomDomainsHelp } from './CustomDomainsHelp';
import DomainsPage from './pages/DomainsPage';
import ApiKeysPage from './pages/ApiKeysPage';
import SettingsPage from './pages/SettingsPage';

// Admin custom-domains module, mounted at `/admin/custom-domains/*`. Unlike
// the webhooks module we do NOT hard-gate on the enabled flag — the operator
// needs to configure the Cloudflare token, API keys and domains here *before*
// flipping the module on, so the enable toggle lives in the Settings sub-page.
export default function CustomDomainsSection() {
    return (
        <div className="flex flex-col gap-6">
            <header className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-ink)]">
                        {m['admin.customDomains.title']()}
                    </h1>
                    <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.customDomains.subtitle']()}</p>
                </div>
                <AdminCustomDomainsHelp />
            </header>

            <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
                <CustomDomainsNav />
                <div className="min-w-0 flex-1">
                    <Routes>
                        <Route index element={<DomainsPage />} />
                        <Route path="api-keys" element={<ApiKeysPage />} />
                        <Route path="settings" element={<SettingsPage />} />
                    </Routes>
                </div>
            </div>
        </div>
    );
}

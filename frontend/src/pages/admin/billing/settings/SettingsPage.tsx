import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { Coins, CreditCard, SlidersHorizontal, Wrench, type LucideIcon } from 'lucide-react';
import { m } from '@/i18n/messages';
import { cn } from '@/lib/cn';
import GeneralTab from './GeneralTab';
import PricingTab from './PricingTab';
import PaymentsTab from './PaymentsTab';
import AdvancedTab from './AdvancedTab';

const BASE = '/admin/billing/settings';

interface Tab {
    to: string;
    end?: boolean;
    icon: LucideIcon;
    label: () => string;
}

const TABS: Tab[] = [
    { to: BASE, end: true, icon: Coins, label: m['admin.billing.settings.tabs.general'] },
    { to: `${BASE}/pricing`, icon: SlidersHorizontal, label: m['admin.billing.settings.tabs.pricing'] },
    { to: `${BASE}/payments`, icon: CreditCard, label: m['admin.billing.settings.tabs.payments'] },
    { to: `${BASE}/advanced`, icon: Wrench, label: m['admin.billing.settings.tabs.advanced'] },
];

// Billing settings, split across four routed tabs. It was one page of six cards
// covering four unrelated jobs (money formatting, pricing math, provider
// credentials, destructive actions) — six screens of scrolling with nothing to
// mark where one job ended and the next began.
//
// The tabs are routes rather than local state so they're linkable and survive a
// refresh, and so each tab only fetches its own data (node pricing no longer
// loads for someone who came to change the currency). A horizontal strip, not a
// rail: BillingNav already occupies the left column beside the admin sidebar.
export default function SettingsPage() {
    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-xl font-semibold text-[var(--color-ink)]">{m['admin.billing.settings.title']()}</h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.billing.settings.subtitle']()}</p>
            </div>

            <nav
                aria-label={m['admin.billing.settings.tabsAria']()}
                className="flex gap-1 overflow-x-auto rounded-[var(--radius-card)] border border-[var(--color-border-strong)] bg-[var(--color-surface)]/70 p-1"
            >
                {TABS.map(tab => (
                    <NavLink
                        key={tab.to}
                        to={tab.to}
                        end={tab.end}
                        className={({ isActive }) =>
                            cn(
                                'flex shrink-0 items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors',
                                isActive
                                    ? 'bg-[var(--brand)]/15 text-[var(--color-ink)] ring-1 ring-[var(--brand)]/30'
                                    : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-ink)]',
                            )
                        }
                    >
                        <tab.icon className="h-4 w-4 shrink-0" />
                        <span className="whitespace-nowrap">{tab.label()}</span>
                    </NavLink>
                ))}
            </nav>

            <Routes>
                <Route index element={<GeneralTab />} />
                <Route path="pricing" element={<PricingTab />} />
                <Route path="payments" element={<PaymentsTab />} />
                <Route path="advanced" element={<AdvancedTab />} />
                {/* Old deep links (and anything typed by hand) land on General
                    rather than an empty page under a highlighted tab strip. */}
                <Route path="*" element={<Navigate to={BASE} replace />} />
            </Routes>
        </div>
    );
}

import { m } from '@/i18n';
import GeneralSection from './GeneralSection';
import BillingRulesSection from './BillingRulesSection';
import IntegrationsSection from './IntegrationsSection';

// Billing settings, consolidated onto one sectioned page (V2 folds the old
// standalone V1 "Billing Rules" and "Payment Integrations" sidebar pages in
// here as sections): general config → cycle/node pricing rules → integrations.
export default function SettingsPage() {
    return (
        <div className="flex flex-col gap-8">
            <div>
                <h1 className="text-xl font-semibold text-[var(--color-ink)]">{m['admin.billing.settings.title']()}</h1>
                <p className="mt-1 text-sm text-[var(--color-ink-muted)]">{m['admin.billing.settings.subtitle']()}</p>
            </div>

            <GeneralSection />
            <BillingRulesSection />
            <IntegrationsSection />
        </div>
    );
}

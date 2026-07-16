import { useMemo } from 'react';
import { useStoreState } from '@/state/hooks';
import { Route, Routes } from 'react-router-dom';
import { NotFound } from '@/elements/ScreenBlock';
import AdminContentBlock from '@/elements/AdminContentBlock';
import EnableBilling from '@admin/modules/billing/EnableBilling';
import FlashMessageRender from '@/elements/FlashMessageRender';
import ProductForm from '@admin/modules/billing/products/ProductForm';
import CategoryForm from '@admin/modules/billing/products/CategoryForm';
import OverviewContainer from '@/components/admin/modules/billing/overview/OverviewContainer';
import CategoryTable from '@admin/modules/billing/products/CategoryTable';
import OrdersContainer from '@admin/modules/billing/orders/OrdersContainer';
import ProductContainer from '@admin/modules/billing/products/ProductContainer';
import CategoryContainer from '@admin/modules/billing/products/CategoryContainer';
import CouponsContainer from '@admin/modules/billing/coupons/CouponsContainer';
import CouponForm from '@admin/modules/billing/coupons/CouponForm';
import SettingsContainer from '@admin/modules/billing/SettingsContainer';
import BillingExceptionsContainer from './exceptions/BillingExceptionsContainer';
import BillingRulesContainer from '@admin/modules/billing/BillingRulesContainer';
import IntegrationsContainer from './integrations/IntegrationsContainer';
import InvoicesContainer from './invoices/InvoicesContainer';
import InvoiceSettingsContainer from './settings/InvoiceSettingsContainer';
import { createIntegrationRegistry, getEnabledIntegrations } from './integrations/registry';
import { BillingSidebar } from './BillingSidebar';

export default () => {
    const enabled = useStoreState(state => state.everest.data!.billing.enabled);
    const billingSettings = useStoreState(state => state.everest.data!.billing);

    // Must be called before any early return to satisfy rules-of-hooks
    const enabledIntegrations = useMemo(
        () => getEnabledIntegrations(createIntegrationRegistry(billingSettings)),
        [billingSettings],
    );

    if (!enabled) return <EnableBilling />;

    return (
        <AdminContentBlock title={'Billing'}>
            <div className={'mb-6 flex w-full flex-col gap-2 sm:flex-row sm:items-center'}>
                <div className={'flex flex-shrink flex-col'} style={{ minWidth: '0' }}>
                    <h2 className={'font-header text-2xl font-medium text-neutral-50'}>Billing</h2>
                    <p className={'overflow-hidden overflow-ellipsis whitespace-nowrap text-base text-neutral-400'}>
                        Configure the billing settings for this panel.
                    </p>
                </div>
            </div>

            {/* Two-column layout: sidebar + content */}
            <div className={'flex gap-6'}>
                <BillingSidebar enabledIntegrations={enabledIntegrations} />

                <div className={'min-w-0 flex-1'}>
                    <FlashMessageRender byKey={'admin:billing'} className={'mb-4'} />

                    <Routes>
                        <Route path={'/'} element={<OverviewContainer />} />

                        <Route path={'/categories'} element={<CategoryTable />} />
                        <Route path={'/categories/new'} element={<CategoryForm />} />
                        <Route path={'/categories/:id'} element={<CategoryContainer />} />

                        <Route path={'/categories/:id/products/new'} element={<ProductForm />} />
                        <Route path={'/categories/:id/products/:productId'} element={<ProductContainer />} />

                        <Route path={'/orders'} element={<OrdersContainer />} />

                        <Route path={'/coupons'} element={<CouponsContainer />} />
                        <Route path={'/coupons/new'} element={<CouponForm />} />
                        <Route path={'/coupons/:id'} element={<CouponForm />} />

                        <Route path={'/exceptions'} element={<BillingExceptionsContainer />} />

                        <Route path={'/billing-rules'} element={<BillingRulesContainer />} />
                        {/* Keep old route for backward compatibility */}
                        <Route path={'/renewal-dates'} element={<BillingRulesContainer />} />

                        <Route path={'/integrations'} element={<IntegrationsContainer />} />

                        {/* Dynamic routes for enabled integrations */}
                        {enabledIntegrations.map(integration => (
                            <Route
                                key={integration.id}
                                path={`/integrations/${integration.id}`}
                                element={<integration.settingsComponent />}
                            />
                        ))}

                        <Route path={'/settings'} element={<SettingsContainer />} />
                        <Route path={'/invoices'} element={<InvoicesContainer />} />
                        <Route path={'/invoice-settings'} element={<InvoiceSettingsContainer />} />

                        <Route path={'/*'} element={<NotFound />} />
                    </Routes>
                </div>
            </div>
        </AdminContentBlock>
    );
};

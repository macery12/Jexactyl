import { Routes, Route } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { BillingNav } from './BillingNav';
import { RequireAdminPermission } from '@/components/permissions/RequireAdminPermission';
import { Spinner } from '@/components/ui/Spinner';

const BillingOverviewPage = lazy(() => import('./BillingOverviewPage'));
const ProductsPage = lazy(() => import('./products/ProductsPage'));
const ProductEditorPage = lazy(() => import('./products/ProductEditorPage'));
const CategoryDetailPage = lazy(() => import('./products/CategoryDetailPage'));
const OrdersPage = lazy(() => import('./orders/OrdersPage'));
const InvoicesPage = lazy(() => import('./invoices/InvoicesPage'));
const CouponsPage = lazy(() => import('./coupons/CouponsPage'));
const ExceptionsPage = lazy(() => import('./exceptions/ExceptionsPage'));
const SettingsPage = lazy(() => import('./settings/SettingsPage'));
const InvoiceSettingsPage = lazy(() => import('./invoicesettings/InvoiceSettingsPage'));
const StoreEditor = lazy(() => import('./store/StoreEditor'));

function guarded(permission: string, element: React.ReactElement) {
    return <RequireAdminPermission permission={permission}>{element}</RequireAdminPermission>;
}

// Mounted at the admin `billing/*` splat route. Owns the billing overview, the
// category-grouped product catalog, and the product editor. The secondary
// navigation lives HERE (an in-page rail), not on the main admin sidebar.
// The product editor is a focused full-page route, so it renders without the rail.
export default function BillingSection() {
    return (
        <Suspense fallback={<div className="flex justify-center py-24"><Spinner className="h-7 w-7" /></div>}>
            <Routes>
                <Route path="products/categories/new" element={guarded('billing.categories-create', <CategoryDetailPage />)} />
                <Route path="products/categories/:categoryId" element={guarded('billing.categories-update', <CategoryDetailPage />)} />
                <Route path="products/new" element={guarded('billing.products-create', <ProductEditorPage />)} />
                <Route path="products/:productId" element={guarded('billing.products-update', <ProductEditorPage />)} />
                <Route
                    path="*"
                    element={
                        <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
                            <BillingNav />
                            <div className="min-w-0 flex-1">
                                <Routes>
                                    <Route index element={guarded('billing.read', <BillingOverviewPage />)} />
                                    <Route path="products" element={guarded('billing.read', <ProductsPage />)} />
                                    <Route path="store" element={guarded('billing.update', <StoreEditor />)} />
                                    <Route path="orders" element={guarded('billing.orders', <OrdersPage />)} />
                                    <Route path="invoices" element={guarded('billing.read', <InvoicesPage />)} />
                                    <Route path="coupons" element={guarded('billing.read', <CouponsPage />)} />
                                    <Route path="exceptions" element={guarded('billing.exceptions', <ExceptionsPage />)} />
                                    {/* Splat: billing settings owns four routed tabs of its own. */}
                                    <Route path="settings/*" element={guarded('billing.update', <SettingsPage />)} />
                                    <Route path="invoice-settings" element={guarded('billing.update', <InvoiceSettingsPage />)} />
                                </Routes>
                            </div>
                        </div>
                    }
                />
            </Routes>
        </Suspense>
    );
}

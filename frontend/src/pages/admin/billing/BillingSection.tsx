import { Routes, Route } from 'react-router-dom';
import BillingOverviewPage from './BillingOverviewPage';
import ProductsPage from './products/ProductsPage';
import ProductEditorPage from './products/ProductEditorPage';
import CategoryDetailPage from './products/CategoryDetailPage';
import OrdersPage from './orders/OrdersPage';
import InvoicesPage from './invoices/InvoicesPage';
import CouponsPage from './coupons/CouponsPage';
import ExceptionsPage from './exceptions/ExceptionsPage';
import SettingsPage from './settings/SettingsPage';
import InvoiceSettingsPage from './invoicesettings/InvoiceSettingsPage';
import StoreEditor from './store/StoreEditor';
import { BillingNav } from './BillingNav';
import { RequireAdminPermission } from '@/components/permissions/RequireAdminPermission';

function guarded(permission: string, element: React.ReactElement) {
    return <RequireAdminPermission permission={permission}>{element}</RequireAdminPermission>;
}

// Mounted at the admin `billing/*` splat route. Owns the billing overview, the
// category-grouped product catalog, and the product editor. The secondary
// navigation lives HERE (an in-page rail), not on the main admin sidebar.
// The product editor is a focused full-page route, so it renders without the rail.
export default function BillingSection() {
    return (
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
    );
}

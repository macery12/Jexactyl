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

// Mounted at the admin `billing/*` splat route. Owns the billing overview, the
// category-grouped product catalog, and the product editor. The secondary
// navigation lives HERE (an in-page rail), not on the main admin sidebar.
// The product editor is a focused full-page route, so it renders without the rail.
export default function BillingSection() {
    return (
        <Routes>
            <Route path="products/categories/new" element={<CategoryDetailPage />} />
            <Route path="products/categories/:categoryId" element={<CategoryDetailPage />} />
            <Route path="products/new" element={<ProductEditorPage />} />
            <Route path="products/:productId" element={<ProductEditorPage />} />
            <Route
                path="*"
                element={
                    <div className="flex flex-col gap-6 lg:flex-row lg:gap-8">
                        <BillingNav />
                        <div className="min-w-0 flex-1">
                            <Routes>
                                <Route index element={<BillingOverviewPage />} />
                                <Route path="products" element={<ProductsPage />} />
                                <Route path="store" element={<StoreEditor />} />
                                <Route path="orders" element={<OrdersPage />} />
                                <Route path="invoices" element={<InvoicesPage />} />
                                <Route path="coupons" element={<CouponsPage />} />
                                <Route path="exceptions" element={<ExceptionsPage />} />
                                <Route path="settings" element={<SettingsPage />} />
                                <Route path="invoice-settings" element={<InvoiceSettingsPage />} />
                            </Routes>
                        </div>
                    </div>
                }
            />
        </Routes>
    );
}

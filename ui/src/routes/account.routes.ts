import { lazy } from 'react';
import { LayoutDashboard, Settings, LifeBuoy, ShoppingCart, ReceiptText, Activity } from 'lucide-react';
import { route, type RouteDef } from './registry';

const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage'));
const AccountPage = lazy(() => import('@/pages/account/settings/AccountPage'));
const ActivityPage = lazy(() => import('@/pages/account/activity/ActivityPage'));
const TicketsPage = lazy(() => import('@/pages/account/tickets/TicketsPage'));
const TicketDetailPage = lazy(() => import('@/pages/account/tickets/TicketDetailPage'));
const StorePage = lazy(() => import('@/pages/account/billing/store/StorePage'));
const ConfigureCheckout = lazy(() => import('@/pages/account/billing/order/ConfigureCheckout'));
const PaymentPage = lazy(() => import('@/pages/account/billing/payment/PaymentPage'));
const ProcessingPage = lazy(() => import('@/pages/account/billing/payment/ProcessingPage'));
const SuccessPage = lazy(() => import('@/pages/account/billing/payment/SuccessPage'));
const CancelPage = lazy(() => import('@/pages/account/billing/payment/CancelPage'));

// Account / Dashboard area (/v2/*). Seeded from V1_UI_Map §3.2.
// Root ('') is the server-list dashboard — the authenticated landing target.
export const accountRoutes: RouteDef[] = [
    route('', { name: 'Dashboard', icon: LayoutDashboard, element: DashboardPage, end: true }),
    route('tickets', { name: 'Tickets', icon: LifeBuoy, element: TicketsPage, condition: f => f.tickets.enabled }),
    route('tickets/:id', { element: TicketDetailPage, condition: f => f.tickets.enabled }),
    route('billing/order', { name: 'Store', icon: ShoppingCart, element: StorePage, condition: f => f.billing.enabled }),
    route('billing/orders', { name: 'Orders', icon: ReceiptText, condition: f => f.billing.enabled }),
    route('activity', { name: 'Activity', icon: Activity, element: ActivityPage }),
    route('settings', { name: 'Settings', icon: Settings, element: AccountPage }),
    route('checkout/configure/:id', { element: ConfigureCheckout, condition: f => f.billing.enabled }),
    route('checkout/payment', { element: PaymentPage, condition: f => f.billing.enabled }),
    route('billing/processing', { element: ProcessingPage, condition: f => f.billing.enabled }),
    route('billing/success', { element: SuccessPage, condition: f => f.billing.enabled }),
    route('billing/cancel', { element: CancelPage, condition: f => f.billing.enabled }),
];

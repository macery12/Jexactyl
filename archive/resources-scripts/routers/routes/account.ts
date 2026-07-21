import { lazy } from 'react';
import {ShoppingCartIcon, ClipboardListIcon, KeyIcon, ShieldCheckIcon, ShoppingBagIcon, TicketIcon, UserIcon, EyeIcon } from '@heroicons/react/outline';
import { route, type RouteDefinition } from '@/routers/routes/utils';

const CredentialsContainer = lazy(() => import('@account/CredentialsContainer'));
const AccountOverviewContainer = lazy(() => import('@account/AccountOverviewContainer'));
const SecurityContainer = lazy(() => import('@account/SecurityContainer'));
const UserActivityContainer = lazy(() => import('@account/activity/UserActivityContainer'));

const TicketContainer = lazy(() => import('@account/tickets/TicketContainer'));
const ViewTicketContainer = lazy(() => import('@account/tickets/view/ViewTicketContainer'));

const ProductsContainer = lazy(() => import('@account/billing/ProductsContainer'));
const OrderContainer = lazy(() => import('@account/billing/order/OrderContainer'));
const CheckoutPaymentContainer = lazy(() => import('@account/billing/order/CheckoutPaymentContainer'));
const OrdersContainer = lazy(() => import('@account/billing/orders/OrdersContainer'));
const Processing = lazy(() => import('@account/billing/order/summary/Processing'));
const Success = lazy(() => import('@account/billing/order/summary/Success'));
const Cancel = lazy(() => import('@account/billing/order/summary/Cancel'));

const account: RouteDefinition[] = [
    /**
     * Account - General Routes
     */
    route('', AccountOverviewContainer, { name: 'Account', end: true, icon: UserIcon }),
    route('credentials', CredentialsContainer, { name: 'Credentials', icon: KeyIcon }),
    route('security', SecurityContainer, { name: 'Security', icon: ShieldCheckIcon }),
    route('activity', UserActivityContainer, { name: 'Activity', icon: EyeIcon }),

    /**
     * Account - Ticket Routes
     */
    route('tickets', TicketContainer, {
        name: 'Tickets',
        icon: TicketIcon,
        condition: flags => flags.tickets.enabled,
    }),
    route('tickets/:id', ViewTicketContainer, { condition: flags => flags.tickets.enabled }),

    /**
     * Account - Billing Routes
     */
    route('billing/order', ProductsContainer, {
        name: 'Store',
        icon: ShoppingCartIcon,
        condition: flags => flags.billing.enabled,
    }),
    route('/checkout/configure/:id', OrderContainer),
    route('/checkout/payment', CheckoutPaymentContainer),
    route('billing/order/:id', OrderContainer),
    route('billing/orders', OrdersContainer, {
        name: 'Orders',
        icon: ClipboardListIcon,
        condition: flags => flags.billing.enabled,
    }),
    route('billing/processing', Processing),
    route('billing/success', Success),
    route('billing/cancel', Cancel),
];

export default account;

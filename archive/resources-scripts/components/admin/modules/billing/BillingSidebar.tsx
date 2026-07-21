import { memo, useMemo } from 'react';
import { NavLink } from 'react-router-dom';
import classNames from 'classnames';
import { useStoreState } from '@/state/hooks';
import {
    DesktopComputerIcon,
    ShoppingCartIcon,
    TicketIcon,
    CalendarIcon,
    XCircleIcon,
    CogIcon,
} from '@heroicons/react/outline';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faPuzzlePiece, faBoxesStacked, faFileInvoiceDollar } from '@fortawesome/free-solid-svg-icons';
import type { BillingIntegration } from './integrations/types';
import type { ReactNode } from 'react';

interface NavItem {
    to: string;
    end?: boolean;
    icon: ReactNode;
    label: string;
}

interface Section {
    label: string;
    items: NavItem[];
}

const SidebarLink = memo(({ to, end, icon, label, primaryColor }: NavItem & { primaryColor: string }) => (
    <NavLink
        to={to}
        end={end}
        className={({ isActive }) =>
            classNames(
                'flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150',
                isActive ? 'bg-black/25 text-white' : 'text-neutral-400 hover:bg-white/5 hover:text-neutral-200',
            )
        }
        style={({ isActive }) => (isActive ? { color: primaryColor } : undefined)}
    >
        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">{icon}</span>
        <span className="truncate">{label}</span>
    </NavLink>
));

SidebarLink.displayName = 'SidebarLink';

interface Props {
    enabledIntegrations: BillingIntegration[];
}

export const BillingSidebar = memo(({ enabledIntegrations }: Props) => {
    const theme = useStoreState(state => state.theme.data!);

    const sections = useMemo(
        (): Section[] => [
            {
                label: 'Dashboard',
                items: [
                    {
                        to: '/admin/billing',
                        end: true,
                        icon: <DesktopComputerIcon className="h-4 w-4" />,
                        label: 'Overview',
                    },
                ],
            },
            {
                label: 'Transactions',
                items: [
                    {
                        to: '/admin/billing/orders',
                        icon: <ShoppingCartIcon className="h-4 w-4" />,
                        label: 'Orders',
                    },
                    {
                        to: '/admin/billing/invoices',
                        icon: <FontAwesomeIcon icon={faFileInvoiceDollar} className="h-4 w-4" />,
                        label: 'Invoices',
                    },
                ],
            },
            {
                label: 'Catalog',
                items: [
                    {
                        to: '/admin/billing/categories',
                        icon: <FontAwesomeIcon icon={faBoxesStacked} className="h-4 w-4" />,
                        label: 'Products',
                    },
                    {
                        to: '/admin/billing/coupons',
                        icon: <TicketIcon className="h-4 w-4" />,
                        label: 'Coupons',
                    },
                ],
            },
            {
                label: 'Payment Integrations',
                items: [
                    {
                        to: '/admin/billing/integrations',
                        end: true,
                        icon: <FontAwesomeIcon icon={faPuzzlePiece} className="h-4 w-4" />,
                        label: 'All Integrations',
                    },
                    ...enabledIntegrations.map(integration => ({
                        to: `/admin/billing/integrations/${integration.id}`,
                        icon: <FontAwesomeIcon icon={integration.icon} className="h-4 w-4" />,
                        label: integration.name,
                    })),
                ],
            },
            {
                label: 'Exceptions',
                items: [
                    {
                        to: '/admin/billing/exceptions',
                        icon: <XCircleIcon className="h-4 w-4" />,
                        label: 'Exceptions',
                    },
                ],
            },
            {
                label: 'Configuration',
                items: [
                    {
                        to: '/admin/billing/billing-rules',
                        icon: <CalendarIcon className="h-4 w-4" />,
                        label: 'Billing Rules',
                    },
                    {
                        to: '/admin/billing/settings',
                        icon: <CogIcon className="h-4 w-4" />,
                        label: 'Settings',
                    },
                    {
                        to: '/admin/billing/invoice-settings',
                        icon: <CogIcon className="h-4 w-4" />,
                        label: 'Invoice Settings',
                    },
                ],
            },
        ],
        [enabledIntegrations],
    );

    // Flat list used by the mobile bar (all items, no section headers)
    const mobileItems = useMemo(() => sections.flatMap(s => s.items), [sections]);

    return (
        <>
            {/* Desktop sidebar — hidden below md */}
            <nav className="hidden w-52 flex-shrink-0 md:flex md:flex-col" aria-label="Billing navigation">
                <div className="flex flex-col gap-4 rounded-lg p-3" style={{ backgroundColor: theme.colors.sidebar }}>
                    {sections.map(section => (
                        <div key={section.label}>
                            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-widest text-neutral-500">
                                {section.label}
                            </p>
                            <div className="flex flex-col gap-0.5">
                                {section.items.map(item => (
                                    <SidebarLink key={item.to} {...item} primaryColor={theme.colors.primary} />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </nav>

            {/* Mobile horizontal nav — shown below md only */}
            <nav
                className="mb-4 flex overflow-x-auto md:hidden"
                aria-label="Billing navigation"
                style={{ WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
            >
                <div className="flex flex-nowrap gap-1 pb-2">
                    {mobileItems.map(item => (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            end={item.end}
                            className={({ isActive }) =>
                                classNames(
                                    'flex flex-shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors duration-150',
                                    isActive
                                        ? 'bg-black/25 text-white'
                                        : 'text-neutral-400 hover:bg-white/5 hover:text-neutral-200',
                                )
                            }
                            style={({ isActive }) =>
                                isActive
                                    ? {
                                          color: theme.colors.primary,
                                          backgroundColor: `${theme.colors.primary}26`,
                                      }
                                    : undefined
                            }
                        >
                            <span className="flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center">
                                {item.icon}
                            </span>
                            <span className="whitespace-nowrap">{item.label}</span>
                        </NavLink>
                    ))}
                </div>
            </nav>
        </>
    );
});

BillingSidebar.displayName = 'BillingSidebar';

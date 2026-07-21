import { Menu, Transition } from '@headlessui/react';
import { ChevronDownIcon } from '@heroicons/react/solid';
import { NavLink } from 'react-router-dom';
import classNames from 'classnames';
import type { ComponentType, ReactNode } from 'react';
import { useStoreState } from '@/state/hooks';
import type { SiteTheme } from '@/state/theme';
import { useRef, useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

interface DropdownItemProps {
    to: string;
    name: string;
    icon?: ComponentType<{ className?: string }>;
    children?: ReactNode;
}

const BillingDropdownItem = ({
    to,
    name,
    icon: IconComponent,
    children,
    theme,
}: DropdownItemProps & { theme: SiteTheme }) => (
    <Menu.Item>
        {({ active }) => (
            <NavLink
                to={to}
                className="flex items-center px-4 py-2 text-sm transition-colors"
                style={
                    active
                        ? {
                              backgroundColor: theme.colors.headers,
                              color: theme.colors.primary,
                          }
                        : {
                              color: '#d1d5db', // neutral-300
                          }
                }
            >
                {IconComponent ? (
                    <IconComponent className="mr-2 h-5 w-5" />
                ) : (
                    children && <div className="mr-2 h-5 w-5">{children}</div>
                )}
                {name}
            </NavLink>
        )}
    </Menu.Item>
);

interface BillingDropdownProps {
    items: DropdownItemProps[];
    icon?: ComponentType<{ className?: string }>;
    label?: string;
}

export const BillingDropdown = ({ items, icon: IconComponent, label = 'Billing' }: BillingDropdownProps) => {
    const theme = useStoreState(state => state.theme.data!);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });

    const updatePosition = useCallback(() => {
        if (buttonRef.current) {
            const rect = buttonRef.current.getBoundingClientRect();
            setDropdownPosition({
                top: rect.bottom,
                left: rect.left,
            });
        }
    }, []);

    useEffect(() => {
        updatePosition();
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);

        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [updatePosition]);

    return (
        <Menu as="div" className="relative inline-block h-full">
            {({ open }) => (
                <>
                    <Menu.Button
                        ref={buttonRef}
                        className={classNames(
                            'flex h-full flex-row items-center whitespace-nowrap border-b px-4 text-base transition-colors',
                            open ? 'border-primary text-primary' : 'border-transparent text-neutral-300',
                        )}
                        style={
                            open
                                ? {
                                      color: theme.colors.primary,
                                      borderColor: theme.colors.primary,
                                  }
                                : undefined
                        }
                        onClick={updatePosition}
                    >
                        {IconComponent && <IconComponent className="mr-2 h-5 w-5" />}
                        <span>{label}</span>
                        <ChevronDownIcon
                            className={classNames('ml-2 h-4 w-4 transition-transform', open && 'rotate-180')}
                        />
                    </Menu.Button>
                    {open &&
                        createPortal(
                            <Transition
                                show={open}
                                enter="transition duration-100 ease-out"
                                enterFrom="transform scale-95 opacity-0"
                                enterTo="transform scale-100 opacity-100"
                                leave="transition duration-75 ease-out"
                                leaveFrom="transform scale-100 opacity-100"
                                leaveTo="transform scale-95 opacity-0"
                            >
                                <Menu.Items
                                    static
                                    className="fixed w-56 origin-top-left rounded shadow-lg focus:outline-none"
                                    style={{
                                        backgroundColor: theme.colors.sidebar,
                                        borderColor: theme.colors.headers,
                                        borderWidth: '1px',
                                        zIndex: 9999,
                                        top: `${dropdownPosition.top}px`,
                                        left: `${dropdownPosition.left}px`,
                                    }}
                                >
                                    <div className="py-1">
                                        {items.map(item => (
                                            <BillingDropdownItem key={item.to} {...item} theme={theme} />
                                        ))}
                                    </div>
                                </Menu.Items>
                            </Transition>,
                            document.body,
                        )}
                </>
            )}
        </Menu>
    );
};

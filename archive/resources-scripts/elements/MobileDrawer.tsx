import { createContext, ElementType, Fragment, ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faBars, faHome, faTimes } from '@fortawesome/free-solid-svg-icons';
import { useStoreState } from '@/state/hooks';

interface DrawerContextValue {
    isOpen: boolean;
    open: () => void;
    close: () => void;
}

const DrawerContext = createContext<DrawerContextValue>({ isOpen: false, open: () => {}, close: () => {} });

export const useDrawer = () => useContext(DrawerContext);

/**
 * MobileDrawer – wraps the page and provides:
 *  • A hamburger trigger rendered via <MobileDrawer.Trigger />
 *  • A full-height off-canvas drawer that slides from the left
 *
 * Visible only below the `md` breakpoint (< 768 px).
 */
const MobileDrawer = ({ children }: { children: ReactNode }) => {
    const [isOpen, setIsOpen] = useState(false);
    const location = useLocation();

    const open = useCallback(() => setIsOpen(true), []);
    const close = useCallback(() => setIsOpen(false), []);

    // Close drawer whenever the route changes (user tapped a link).
    useEffect(() => {
        setIsOpen(false);
    }, [location.pathname]);

    // Close on Escape key.
    useEffect(() => {
        if (!isOpen) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setIsOpen(false);
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [isOpen]);

    // Prevent body scrolling when open.
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = '';
        }
        return () => {
            document.body.style.overflow = '';
        };
    }, [isOpen]);

    return <DrawerContext.Provider value={{ isOpen, open, close }}>{children}</DrawerContext.Provider>;
};

/* ------------------------------------------------------------------ */
/*  Trigger – the hamburger button (only visible on mobile)           */
/* ------------------------------------------------------------------ */
const Trigger = () => {
    const { open } = useDrawer();
    const { colors } = useStoreState(s => s.theme.data!);

    return (
        <button
            onClick={open}
            className="flex items-center justify-center md:hidden"
            style={{ color: colors.primary }}
            aria-label="Open navigation menu"
        >
            <FontAwesomeIcon icon={faBars} className="h-5 w-5" />
        </button>
    );
};

/* ------------------------------------------------------------------ */
/*  Panel – the sliding drawer (backdrop + sidebar)                   */
/* ------------------------------------------------------------------ */
const Panel = ({ children }: { children: ReactNode }) => {
    const { isOpen, close } = useDrawer();
    const { colors } = useStoreState(s => s.theme.data!);

    return (
        <Fragment>
            {/* backdrop */}
            <div
                className={`fixed inset-0 z-[60] bg-black/60 transition-opacity duration-300 md:hidden ${
                    isOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
                }`}
                onClick={close}
            />

            {/* drawer */}
            <div
                className={`fixed inset-y-0 left-0 z-[70] flex w-64 flex-col overflow-y-auto transition-transform duration-300 ease-in-out md:hidden ${
                    isOpen ? 'translate-x-0' : '-translate-x-full'
                }`}
                style={{ backgroundColor: colors.sidebar }}
            >
                {/* close button */}
                <div className="flex items-center justify-end px-4 pt-4">
                    <button
                        onClick={close}
                        className="flex h-8 w-8 items-center justify-center rounded-full text-neutral-400 transition hover:text-neutral-100"
                        aria-label="Close navigation menu"
                    >
                        <FontAwesomeIcon icon={faTimes} className="h-4 w-4" />
                    </button>
                </div>

                {/* nav items */}
                <nav className="flex flex-1 flex-col gap-1 px-3 pt-2 pb-6">{children}</nav>
            </div>
        </Fragment>
    );
};

/* ------------------------------------------------------------------ */
/*  Section – optional label/divider inside the drawer                */
/* ------------------------------------------------------------------ */
const Section = ({ children }: { children: ReactNode }) => (
    <div className="mt-4 mb-1 ml-1 select-none text-xs font-medium uppercase text-neutral-400">{children}</div>
);

/* ------------------------------------------------------------------ */
/*  Link – a single navigation link inside the drawer                 */
/* ------------------------------------------------------------------ */
interface DrawerLinkProps {
    icon: ElementType;
    text?: string;
    linkTo: string;
    end?: boolean;
    onClick?: (e: React.MouseEvent<HTMLAnchorElement>) => void;
}

const DrawerLink = ({ icon: Icon, text, linkTo, end, onClick }: DrawerLinkProps) => {
    const { colors } = useStoreState(s => s.theme.data!);

    return (
        <NavLink
            to={linkTo}
            end={end}
            className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive ? 'bg-black/25 brightness-150' : 'text-neutral-300 hover:text-neutral-50'
                }`
            }
            style={({ isActive }) => (isActive ? { color: colors.primary } : {})}
            onClick={onClick}
        >
            {Icon && <Icon className="h-5 w-5 flex-shrink-0" />}
            {text && <span>{text}</span>}
        </NavLink>
    );
};

/* ------------------------------------------------------------------ */
/*  Home – a "Home / Dashboard" shortcut at the top of the drawer     */
/* ------------------------------------------------------------------ */
const Home = () => {
    const { colors } = useStoreState(s => s.theme.data!);
    return (
        <NavLink
            to="/"
            end
            className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                    isActive ? 'bg-black/25 brightness-150' : 'text-neutral-300 hover:text-neutral-50'
                }`
            }
            style={({ isActive }) => (isActive ? { color: colors.primary } : {})}
        >
            <FontAwesomeIcon icon={faHome} className="h-5 w-5 flex-shrink-0" style={{ color: colors.primary }} />
            <span>Home</span>
        </NavLink>
    );
};

// Attach sub-components.
MobileDrawer.Trigger = Trigger;
MobileDrawer.Panel = Panel;
MobileDrawer.Section = Section;
MobileDrawer.Link = DrawerLink;
MobileDrawer.Home = Home;

export default MobileDrawer;

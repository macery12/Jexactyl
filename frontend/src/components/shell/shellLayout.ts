import { createContext, useContext, useEffect } from 'react';

export type ContentWidth = 'default' | 'wide' | 'full';

interface ShellLayout {
    setWidth: (width: ContentWidth) => void;
}

// Lets a routed page opt its content container out of the default `max-w-6xl`.
// AppShell owns the state; pages flip it via the hooks below.
export const ShellLayoutContext = createContext<ShellLayout>({ setWidth: () => {} });

// Set the content width for the lifetime of the current page, reverting to the
// default when the page unmounts so no other page is affected.
function useContentWidth(width: ContentWidth) {
    const { setWidth } = useContext(ShellLayoutContext);
    useEffect(() => {
        setWidth(width);
        return () => setWidth('default');
    }, [setWidth, width]);
}

// Wider centred container (e.g. the landing editor's three-column layout).
export function useWideContent() {
    useContentWidth('wide');
}

// Edge-to-edge container that uses the full width between the sidebar and the
// window edge (e.g. the ticket console). No wasted left/right gutters.
export function useFullWidthContent() {
    useContentWidth('full');
}

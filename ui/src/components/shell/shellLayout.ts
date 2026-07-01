import { createContext, useContext, useEffect } from 'react';

interface ShellLayout {
    setWide: (wide: boolean) => void;
}

// Lets a routed page opt its content container into a wider max-width than the
// default `max-w-6xl`. AppShell owns the state; pages flip it via useWideContent.
export const ShellLayoutContext = createContext<ShellLayout>({ setWide: () => {} });

// Opt the current page into the wide content container (e.g. the landing editor's
// three-column layout). Reverts to the default width when the page unmounts, so
// no other page is affected.
export function useWideContent() {
    const { setWide } = useContext(ShellLayoutContext);
    useEffect(() => {
        setWide(true);
        return () => setWide(false);
    }, [setWide]);
}

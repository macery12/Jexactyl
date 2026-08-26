import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Size an element from wherever it sits down to the bottom of the viewport.
 *
 * Both assistant pages used to guess: `h-[calc(100vh-10.5rem)]`, where 10.5rem
 * was somebody's measurement of the shell's header, padding and page title on
 * the day they wrote it. It was wrong whenever anything above changed height — a
 * flash message, a wrapped page title, a narrower breakpoint stacking the header
 * — and wrong in the worst way, because the failure is either dead space under
 * the composer or a second scrollbar on a surface that already scrolls.
 *
 * Measuring removes the guess. The element's own top is read from layout, so it
 * cannot disagree with what is actually above it, and the observer catches the
 * banner that appears an hour into a session as readily as the initial paint.
 *
 * The page itself does not scroll — the transcript inside does — so `top` is
 * stable once painted and this settles after one frame.
 *
 * A callback ref rather than a `useRef`, and that distinction is the whole bug
 * it was written with. A page that renders a spinner while it loads — the admin
 * assistant waits on its settings — has no element on the first mount, so an
 * effect keyed on `[gap]` ran once against `null`, bailed, and never ran again
 * when the container finally appeared. The height was never applied, the panel
 * grew to fit its transcript, and the composer went below the fold. Keying on
 * the node means the measurement happens whenever the node does.
 */
export function useFillViewport<T extends HTMLElement>(gap = 24): (node: T | null) => void {
    // The node lives in a ref and the counter only exists to re-run the effect
    // when it attaches. Holding the node in state instead is what the React
    // Compiler objects to, correctly: writing `el.style` would then be mutating
    // a value returned from `useState`, which for anything that is not a DOM
    // node would be a real bug.
    const elRef = useRef<T | null>(null);
    const [attached, setAttached] = useState(0);

    const ref = useCallback((node: T | null) => {
        elRef.current = node;
        setAttached(count => count + 1);
    }, []);

    useEffect(() => {
        const el = elRef.current;
        if (!el) return;

        const apply = () => {
            const top = el.getBoundingClientRect().top;
            // `visualViewport` is the honest height on mobile, where the URL bar
            // and the on-screen keyboard both shrink the usable area without
            // touching `innerHeight`. A composer hidden behind the keyboard is
            // the whole reason to care.
            const viewport = window.visualViewport?.height ?? window.innerHeight;
            const next = `${Math.max(320, Math.round(viewport - top - gap))}px`;

            // Only when it actually changes. Writing the height resizes the body,
            // which is what the observer below is watching — an unconditional
            // write feeds itself and trips "ResizeObserver loop completed with
            // undelivered notifications" on every layout pass.
            if (el.style.height !== next) el.style.height = next;
        };

        apply();

        // Anything above the element changing height moves its top. Observing
        // the body catches all of it — a banner, a wrapped title, a font swap —
        // without each of them having to know this element exists.
        const observer = new ResizeObserver(apply);
        observer.observe(document.body);

        window.addEventListener('resize', apply);
        window.visualViewport?.addEventListener('resize', apply);

        return () => {
            observer.disconnect();
            window.removeEventListener('resize', apply);
            window.visualViewport?.removeEventListener('resize', apply);
        };
    }, [attached, gap]);

    return ref;
}

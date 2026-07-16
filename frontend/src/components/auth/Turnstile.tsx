import { useEffect, useRef } from 'react';

// Minimal Cloudflare Turnstile wrapper. The challenge script is loaded by the
// Blade template (conditional on SiteConfiguration.captcha). We render the
// widget explicitly and surface the token to the parent.
declare global {
    interface Window {
        turnstile?: {
            render: (el: HTMLElement, opts: Record<string, unknown>) => string;
            remove: (id: string) => void;
        };
    }
}

export function Turnstile({ siteKey, onVerify }: { siteKey: string; onVerify: (token: string) => void }) {
    const ref = useRef<HTMLDivElement>(null);
    const widgetId = useRef<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        const tryRender = () => {
            if (cancelled || !ref.current || !window.turnstile) return false;
            widgetId.current = window.turnstile.render(ref.current, {
                sitekey: siteKey,
                theme: 'dark',
                callback: (token: string) => onVerify(token),
            });
            return true;
        };

        if (!tryRender()) {
            const interval = setInterval(() => {
                if (tryRender()) clearInterval(interval);
            }, 200);
            return () => {
                cancelled = true;
                clearInterval(interval);
                if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
            };
        }

        return () => {
            cancelled = true;
            if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
        };
    }, [siteKey, onVerify]);

    return <div ref={ref} className="flex justify-center" />;
}

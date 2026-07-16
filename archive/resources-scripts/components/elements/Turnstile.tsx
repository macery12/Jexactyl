import { useEffect, useMemo, useRef, useState } from 'react';

interface TurnstileProps {
    siteKey: string;
    onVerify: (token: string) => void;
    onError?: () => void;
    onExpire?: () => void;
}

interface TurnstileRenderOptions {
    sitekey: string;
    callback: (token: string) => void;
    'error-callback'?: () => void;
    'expired-callback'?: () => void;
}

declare global {
    interface Window {
        turnstile?: {
            render: (element: HTMLElement, options: TurnstileRenderOptions) => string;
            reset: (widgetId: string) => void;
            remove: (widgetId: string) => void;
        };
        onTurnstileLoad?: () => void;
    }
}

export default function Turnstile({ siteKey, onVerify, onError, onExpire }: TurnstileProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const widgetId = useRef<string | null>(null);
    const [missingTurnstile, setMissingTurnstile] = useState(false);

    // Store callbacks in refs to avoid re-rendering when they change
    const onVerifyRef = useRef(onVerify);
    const onErrorRef = useRef(onError);
    const onExpireRef = useRef(onExpire);

    // Update refs when callbacks change
    useEffect(() => {
        onVerifyRef.current = onVerify;
        onErrorRef.current = onError;
        onExpireRef.current = onExpire;
    });

    const options: TurnstileRenderOptions | null = useMemo(() => {
        // Build a strict allowlisted options object — never spread arbitrary props into render.
        // The sitekey is sourced from trusted server configuration, not user input.
        if (!siteKey || typeof siteKey !== 'string') return null;

        return {
            sitekey: siteKey,
            callback: (token: string) => onVerifyRef.current(token),
            'error-callback': () => onErrorRef.current?.(),
            'expired-callback': () => {
                widgetId.current = null;
                onExpireRef.current?.();
            },
        };
    }, [siteKey]);

    useEffect(() => {
        if (!containerRef.current || !options) return;

        const initTurnstile = () => {
            if (window.turnstile && containerRef.current && !widgetId.current && options) {
                widgetId.current = window.turnstile.render(containerRef.current, options);
                setMissingTurnstile(false);
            }
        };

        if (window.turnstile) {
            initTurnstile();
        } else {
            window.onTurnstileLoad = initTurnstile;
            setMissingTurnstile(true);
        }

        return () => {
            if (widgetId.current && window.turnstile) {
                window.turnstile.remove(widgetId.current);
                widgetId.current = null;
            }
        };
    }, [options]);

    const containerStyle = {
        minHeight: '65px',
        width: '300px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
    } as const;

    if (!options) {
        return <div ref={containerRef} style={containerStyle} />;
    }

    return (
        <div ref={containerRef} style={containerStyle}>
            {missingTurnstile && !widgetId.current ? 'Loading verification…' : null}
        </div>
    );
}

import type { Stripe } from '@stripe/stripe-js';

// Loads Stripe.js once per publishable key and caches the promise. Ported from
// V1's lib/stripe.ts so the V2 checkout reuses the same battle-tested loader
// (handles an already-injected script and avoids duplicate <script> tags).

type StripeWindow = Window & { Stripe?: (key: string) => Stripe };

let cachedStripePromise: Promise<Stripe | null> | null = null;
let cachedPublishableKey: string | null = null;

export const loadStripeOnce = async (publishableKey: string): Promise<Stripe | null> => {
    if (typeof window === 'undefined' || !publishableKey) return null;

    if (cachedStripePromise && cachedPublishableKey === publishableKey) {
        return cachedStripePromise;
    }

    const existingScript = document.querySelector<HTMLScriptElement>('script[src^="https://js.stripe.com"]');
    if (existingScript) {
        const stripeFactory = (window as StripeWindow).Stripe;

        if (stripeFactory) {
            cachedPublishableKey = publishableKey;
            cachedStripePromise = Promise.resolve(stripeFactory(publishableKey));
            return cachedStripePromise;
        }

        if (!cachedStripePromise) {
            cachedPublishableKey = publishableKey;
            cachedStripePromise = new Promise<Stripe | null>((resolve, reject) => {
                const handleLoad = () => {
                    try {
                        resolve((window as StripeWindow).Stripe?.(publishableKey) ?? null);
                    } catch (error) {
                        cachedPublishableKey = null;
                        cachedStripePromise = null;
                        reject(error);
                    }
                };
                const handleError = (error: Event) => {
                    cachedPublishableKey = null;
                    cachedStripePromise = null;
                    reject(error);
                };
                existingScript.addEventListener('load', handleLoad, { once: true });
                existingScript.addEventListener('error', handleError, { once: true });
            });
        }

        return cachedStripePromise;
    }

    const { loadStripe } = await import('@stripe/stripe-js');
    cachedPublishableKey = publishableKey;
    cachedStripePromise = loadStripe(publishableKey).catch(error => {
        cachedPublishableKey = null;
        cachedStripePromise = null;
        throw error;
    });

    return cachedStripePromise;
};

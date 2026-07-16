import type { Stripe } from '@stripe/stripe-js';

type StripeWindow = Window & { Stripe?: (key: string) => Stripe };

let cachedStripePromise: Promise<Stripe | null> | null = null;
let cachedPublishableKey: string | null = null;

export const loadStripeOnce = async (publishableKey: string): Promise<Stripe | null> => {
    if (typeof window === 'undefined' || !publishableKey) return null;

    // Reuse the existing instance when the same key was already used.
    if (cachedStripePromise && cachedPublishableKey === publishableKey) {
        return cachedStripePromise;
    }

    // If Stripe.js is already on the page, avoid injecting a duplicate script.
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

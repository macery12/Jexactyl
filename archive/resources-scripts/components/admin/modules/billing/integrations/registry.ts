import { faStripe, faPaypal } from '@fortawesome/free-brands-svg-icons';
import { BillingIntegration } from './types';
import StripeSettings from './StripeSettings';
import PayPalSettings from './PayPalSettings';
import { EverestSettings } from '@/state/everest';

/**
 * Creates the integration registry based on current billing settings
 */
export const createIntegrationRegistry = (billingSettings: EverestSettings['billing']): BillingIntegration[] => {
    const stripeConfigured = !!(billingSettings.keys?.publishable && billingSettings.keys?.secret);
    const paypalConfigured = billingSettings.processors?.paypal?.available ?? false;

    return [
        {
            id: 'stripe',
            name: 'Stripe',
            description:
                'Accept credit cards, digital wallets, and bank transfers with Stripe. Industry-leading payment infrastructure.',
            icon: faStripe,
            enabled: billingSettings.integrations?.stripe?.enabled ?? false,
            configured: stripeConfigured,
            settingsComponent: StripeSettings,
        },
        {
            id: 'paypal',
            name: 'PayPal',
            description:
                'Standalone PayPal integration with native checkout experience. Accept PayPal payments directly without Stripe.',
            icon: faPaypal,
            enabled: billingSettings.integrations?.paypal?.enabled ?? false,
            configured: paypalConfigured,
            settingsComponent: PayPalSettings,
        },
    ];
};

/**
 * Get the list of enabled integrations
 */
export const getEnabledIntegrations = (integrations: BillingIntegration[]): BillingIntegration[] => {
    return integrations.filter(integration => integration.enabled);
};

/**
 * Check if at least one payment integration is configured and enabled
 */
export const hasActivePaymentIntegration = (integrations: BillingIntegration[]): boolean => {
    return integrations.some(integration => integration.enabled && integration.configured);
};

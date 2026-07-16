import { IconDefinition } from '@fortawesome/fontawesome-svg-core';

/**
 * Represents a billing integration's metadata and configuration
 */
export interface BillingIntegration {
    /** Unique identifier for the integration */
    id: string;

    /** Display name of the integration */
    name: string;

    /** Brief description of what the integration provides */
    description: string;

    /** Icon to display for this integration */
    icon: IconDefinition;

    /** Whether this integration is currently enabled */
    enabled: boolean;

    /** Whether this integration has been configured with necessary credentials */
    configured: boolean;

    /** Component to render when this integration's tab is selected */
    settingsComponent: React.ComponentType;

    /** Optional setup guide component */
    setupGuideComponent?: React.ComponentType<{ extOpen?: boolean }>;
}

/**
 * Registry of all available billing integrations
 */
export interface IntegrationRegistry {
    [key: string]: BillingIntegration;
}

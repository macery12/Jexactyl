# Billing Integrations

This directory contains the modular billing integration system for M12Labs.

## Structure

- **`types.ts`**: TypeScript interfaces for billing integrations
- **`registry.ts`**: Integration registry and utility functions
- **`IntegrationsContainer.tsx`**: Main UI for managing integrations
- **`StripeSettings.tsx`**: Stripe-specific configuration

## How It Works

### Integration Registry

The registry (`registry.ts`) defines all available payment integrations. Each integration has:

```typescript
{
    id: string;              // Unique identifier
    name: string;            // Display name
    description: string;     // Brief description
    icon: IconDefinition;    // Font Awesome icon
    enabled: boolean;        // Enabled state
    configured: boolean;     // Configuration status
    settingsComponent: ComponentType;  // Settings UI component
}
```

### Dynamic Tab Rendering

The `BillingRouter` component automatically:
1. Loads the integration registry
2. Filters enabled integrations
3. Renders navigation tabs for each enabled integration
4. Routes to the appropriate settings component

### Settings Components

Each integration has a dedicated settings component:
- **StripeSettings**: Manage Stripe API keys, PayPal integration, Link integration

## Adding a New Integration

1. Create a settings component (e.g., `PayPalSettings.tsx`)
2. Add the integration to the registry in `registry.ts`
3. The system will automatically:
   - Show it in the Integrations management page
   - Add a tab when enabled
   - Route to your settings component

## State Management

Integration states are stored in the global Everest store:

```typescript
billing: {
    integrations: {
        stripe: { enabled: boolean },
        // Add new integrations here
    }
}
```

## API Integration

Integration enable/disable uses the existing billing settings API:

```typescript
await updateSettings('integrations:stripe:enabled', true);
```

Keys follow the pattern: `integrations:{integration-id}:{setting-key}`

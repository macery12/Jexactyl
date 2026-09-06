const authenticatedUrl = path => `${path}${path.includes('?') ? '&' : '?'}__lighthouse_auth=1`;

const page = (area, name, path, authenticated = true) => ({
    area,
    name,
    path,
    url: authenticated ? authenticatedUrl(path) : path,
});

const routes = [
    // Public and authentication pages.
    page('public', 'Landing', '/', false),
    page('auth', 'Login', '/auth/login', false),
    page('auth', 'Two-factor checkpoint', '/auth/login/checkpoint', false),
    page('auth', 'Register', '/auth/register', false),
    page('auth', 'Forgot password', '/auth/password', false),
    page('auth', 'Reset password', '/auth/password/reset/lighthouse-token', false),
    page('auth', 'SSO link choice', '/auth/sso/link-choice', false),
    page('auth', 'SSO registration', '/auth/sso/register', false),

    // Account and billing pages.
    page('account', 'Dashboard', '/'),
    page('account', 'Tickets', '/tickets'),
    page('account', 'Ticket detail', '/tickets/1'),
    page('account', 'Store', '/billing/order'),
    page('account', 'Orders', '/billing/orders'),
    page('account', 'Account activity', '/activity'),
    page('account', 'Credentials', '/credentials'),
    page('account', 'Account settings', '/settings'),
    page('account', 'Configure checkout', '/checkout/configure/1'),
    page('account', 'Checkout payment', '/checkout/payment'),
    page('account', 'Billing processing', '/billing/processing'),
    page('account', 'Billing success', '/billing/success'),
    page('account', 'Billing cancellation', '/billing/cancel'),

    // Server pages and their nested route pages.
    page('server', 'Console', '/server/fixture'),
    page('server', 'AI assistant', '/server/fixture/ai'),
    page('server', 'Files', '/server/fixture/files'),
    page('server', 'New file', '/server/fixture/files/new'),
    page('server', 'Edit file', '/server/fixture/files/edit/lighthouse.txt'),
    page('server', 'Databases', '/server/fixture/databases'),
    page('server', 'Marketplace', '/server/fixture/marketplace'),
    page('server', 'Backups', '/server/fixture/backups'),
    page('server', 'Startup', '/server/fixture/startup'),
    page('server', 'Network', '/server/fixture/network'),
    page('server', 'Custom domains', '/server/fixture/custom-domains'),
    page('server', 'Schedules', '/server/fixture/schedules'),
    page('server', 'Schedule detail', '/server/fixture/schedules/1'),
    page('server', 'Users', '/server/fixture/users'),
    page('server', 'Settings', '/server/fixture/settings'),
    page('server', 'Activity', '/server/fixture/activity'),
    page('server', 'Billing', '/server/fixture/billing'),
    page('server', 'Extensions', '/server/fixture/extensions'),
    page('server', 'DiscordSRV helper extension', '/server/fixture/extensions/discordsrv_helper'),
    page('server', 'Minecraft log uploader extension', '/server/fixture/extensions/minecraft_log_uploader'),
    page('server', 'Minecraft icon builder extension', '/server/fixture/extensions/minecraft_icon_builder'),

    // Admin primary pages.
    page('admin', 'Admin overview', '/admin/overview'),
    page('admin', 'Admin assistant', '/admin/assistant'),
    page('admin', 'Panel settings', '/admin/settings'),
    page('admin', 'Feature settings', '/admin/features'),
    page('admin', 'Landing editor', '/admin/landing'),
    page('admin', 'Admin activity', '/admin/activity'),
    page('admin', 'Theme editor', '/admin/theme'),
    page('admin', 'Users', '/admin/access/users'),
    page('admin', 'Access profiles', '/admin/access/profiles'),
    page('admin', 'Access profile detail', '/admin/access/profiles/1'),
    page('admin', 'API keys', '/admin/access/api-keys'),

    // Authentication administration.
    page('admin', 'Authentication modules', '/admin/auth'),
    page('admin', 'JGuard settings', '/admin/auth/jguard'),
    page('admin', 'JGuard pending users', '/admin/auth/jguard/pending'),

    // Billing administration and settings tabs.
    page('admin', 'Billing overview', '/admin/billing'),
    page('admin', 'Billing products', '/admin/billing/products'),
    page('admin', 'New billing category', '/admin/billing/products/categories/new'),
    page('admin', 'Billing category detail', '/admin/billing/products/categories/1'),
    page('admin', 'New billing product', '/admin/billing/products/new'),
    page('admin', 'Billing product detail', '/admin/billing/products/1'),
    page('admin', 'Store editor', '/admin/billing/store'),
    page('admin', 'Billing orders', '/admin/billing/orders'),
    page('admin', 'Billing invoices', '/admin/billing/invoices'),
    page('admin', 'Billing coupons', '/admin/billing/coupons'),
    page('admin', 'Billing exceptions', '/admin/billing/exceptions'),
    page('admin', 'Billing settings', '/admin/billing/settings'),
    page('admin', 'Billing pricing settings', '/admin/billing/settings/pricing'),
    page('admin', 'Billing payment settings', '/admin/billing/settings/payments'),
    page('admin', 'Billing advanced settings', '/admin/billing/settings/advanced'),
    page('admin', 'Invoice settings', '/admin/billing/invoice-settings'),

    // Feature-module administration and nested tabs.
    page('admin', 'Custom domains', '/admin/custom-domains'),
    page('admin', 'Custom-domain API keys', '/admin/custom-domains/api-keys'),
    page('admin', 'Custom-domain settings', '/admin/custom-domains/settings'),
    page('admin', 'Tickets', '/admin/tickets'),
    page('admin', 'Ticket detail', '/admin/tickets/1'),
    page('admin', 'AI overview', '/admin/ai'),
    page('admin', 'AI provider', '/admin/ai/provider'),
    page('admin', 'AI generation', '/admin/ai/generation'),
    page('admin', 'AI agent', '/admin/ai/agent'),
    page('admin', 'AI tools', '/admin/ai/tools'),
    page('admin', 'AI privacy', '/admin/ai/privacy'),
    page('admin', 'AI performance', '/admin/ai/performance'),
    page('admin', 'AI limits', '/admin/ai/limits'),
    page('admin', 'AI logs', '/admin/ai/logs'),
    page('admin', 'Marketplace overview', '/admin/marketplace'),
    page('admin', 'Marketplace settings', '/admin/marketplace/settings'),
    page('admin', 'Marketplace providers', '/admin/marketplace/providers'),
    page('admin', 'Email overview', '/admin/email'),
    page('admin', 'SMTP settings', '/admin/email/smtp'),
    page('admin', 'Resend settings', '/admin/email/resend'),
    page('admin', 'Email testing', '/admin/email/testing'),
    page('admin', 'Email notifications', '/admin/email/notifications'),
    page('admin', 'Email activity', '/admin/email/activity'),
    page('admin', 'Email templates', '/admin/email/templates'),
    page('admin', 'Webhook configuration', '/admin/webhooks'),
    page('admin', 'Webhook events', '/admin/webhooks/events'),
    page('admin', 'Extension management', '/admin/extensions'),
    page('admin', 'Alert settings', '/admin/alerts'),
    page('admin', 'Custom links', '/admin/links'),

    // Core management pages and nested editors/details.
    page('admin', 'Databases', '/admin/databases'),
    page('admin', 'Infrastructure', '/admin/infrastructure'),
    page('admin', 'New node', '/admin/infrastructure/nodes/new'),
    page('admin', 'Node detail', '/admin/infrastructure/nodes/1'),
    page('admin', 'Edit node', '/admin/infrastructure/nodes/1/edit'),
    page('admin', 'New server', '/admin/infrastructure/servers/new'),
    page('admin', 'Server detail', '/admin/infrastructure/servers/1'),
    page('admin', 'Nests', '/admin/nests'),
    page('admin', 'Nest detail', '/admin/nests/1'),
    page('admin', 'New egg', '/admin/nests/1/eggs/new'),
    page('admin', 'Egg detail', '/admin/nests/1/eggs/1'),
    page('admin', 'Queues', '/admin/queues'),
    page('admin', 'Node Health extension', '/admin/extensions/node_health_history'),
    page('admin', 'API documentation', '/admin/developers/api-docs'),
];

const duplicateUrls = routes.filter((route, index) => routes.findIndex(candidate => candidate.url === route.url) !== index);
if (duplicateUrls.length > 0) {
    throw new Error(`Duplicate Lighthouse route URL(s): ${duplicateUrls.map(route => route.url).join(', ')}`);
}

module.exports = { routes };

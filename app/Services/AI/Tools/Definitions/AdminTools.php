<?php

namespace Everest\Services\AI\Tools\Definitions;

use Everest\Models\AdminRole;
use Everest\Services\AI\Tools\ToolDefinition;

/**
 * The admin-scoped toolset: the panel itself, through the Application API.
 *
 * **How this differs from ServerTools, and why it is written down here.** A
 * server-scoped schema accepts no server identifier, because the uuid is bound
 * from the route the turn was opened on — a hallucinated one has nowhere to
 * land. That trick is not available on the admin surface: an administrator acts
 * across every user, product and category by definition, so there is no route
 * context to bind an identifier from, and the ids below genuinely do come from
 * model output.
 *
 * The containment is therefore different in kind rather than absent:
 *
 * 1. This file is an explicit allowlist. Nothing outside it is reachable,
 *    whatever the acting administrator's own capabilities allow.
 * 2. Every call re-checks the declared AdminRole capability twice on the way in
 *    — `AuthorizeApplicationUser`, then the endpoint's own
 *    `ApplicationApiRequest::authorize()` — so a capability the administrator
 *    lacks fails closed regardless of what the model asked for.
 * 3. `scopeBindings()` on the route group 404s a child resource that does not
 *    belong to the parent named in the URI.
 * 4. **No tool here is DESTRUCTIVE.** Deletes, suspensions, reinstalls and
 *    transfers are deliberately not registered, so the worst outcome of a
 *    wrong identifier is a recoverable edit that the administrator already read
 *    on an approval card.
 *
 * Every capability below was read from the endpoint's own
 * `ApplicationApiRequest::permission()`, not inferred from the route name.
 */
class AdminTools
{
    use DefinesToolSchemas;

    public const GROUP_BILLING = 'billing';
    public const GROUP_COMMERCE = 'commerce';
    public const GROUP_SUPPORT = 'support';
    public const GROUP_PANEL = 'panel';

    public const GROUP_DESCRIPTIONS = [
        self::GROUP_BILLING => 'Read the product catalogue, and create or edit products.',
        self::GROUP_COMMERCE => 'Coupons, orders and per-node pricing multipliers.',
        self::GROUP_SUPPORT => 'Read support tickets and their conversations, and open a diagnostic session on the server a ticket is about.',
        self::GROUP_PANEL => 'Read panel feature toggles and server presets.',
    ];

    /**
     * Opens an audited session on a customer's server.
     */
    public const ASSIST_SERVER = 'admin_assist_server';

    /**
     * Widens an open session from read-only to read-write.
     */
    public const ASSIST_ALLOW_WRITES = 'admin_assist_allow_writes';

    private const BASE = '/api/application';

    /**
     * How many rows a listing hands back to the model. Everything here is a
     * full Fractal collection sized for a table, not a context window.
     */
    private const LIST_LIMIT = 25;

    /**
     * @return ToolDefinition[]
     */
    public static function all(): array
    {
        return array_merge(
            self::core(),
            self::billing(),
            self::commerce(),
            self::support(),
            self::panel(),
        );
    }

    /*
    |--------------------------------------------------------------------------
    | Base set — always offered
    |--------------------------------------------------------------------------
    */

    /**
     * @return ToolDefinition[]
     */
    private static function core(): array
    {
        return [
            new ToolDefinition(
                name: 'admin_overview',
                description: 'Panel-wide totals: users, servers, nodes and current resource usage. '
                    . 'Call this first when asked how the panel is doing overall.',
                parameters: [],
                method: 'GET',
                uriTemplate: self::BASE . '/overview',
                scope: ToolDefinition::SCOPE_ADMIN,
                permissions: [AdminRole::OVERVIEW_READ],
            ),

            new ToolDefinition(
                name: 'admin_users_list',
                description: 'List panel users. Use the filter to find someone by email or username '
                    . 'rather than paging through everyone.',
                parameters: self::object([
                    'filter' => self::object([
                        'email' => self::string('Match on email address, partial matches allowed.'),
                        'username' => self::string('Match on username, partial matches allowed.'),
                        'id' => self::string('Exact numeric user id.'),
                        'uuid' => self::string('Exact user uuid.'),
                    ]),
                    'per_page' => self::integer('Rows per page, 1 to 100. Defaults to 20.'),
                    'page' => self::integer('Page number, starting at 1.'),
                ]),
                method: 'GET',
                uriTemplate: self::BASE . '/users',
                scope: ToolDefinition::SCOPE_ADMIN,
                permissions: [AdminRole::USERS_READ],
                resultShaper: fn (mixed $data) => self::mapList($data, fn (array $u) => [
                    'id' => $u['id'] ?? null,
                    'uuid' => $u['uuid'] ?? null,
                    'username' => $u['username'] ?? null,
                    'email' => $u['email'] ?? null,
                    'admin' => $u['root_admin'] ?? null,
                    'suspended' => $u['suspended'] ?? null,
                    'created_at' => $u['created_at'] ?? null,
                ], self::LIST_LIMIT),
                queryFields: ['filter', 'per_page', 'page'],
            ),

            new ToolDefinition(
                name: 'admin_user_view',
                description: 'Full detail for one user, by numeric id. Get the id from admin_users_list.',
                parameters: self::object([
                    'user' => self::string('The numeric user id.'),
                ], ['user']),
                method: 'GET',
                uriTemplate: self::BASE . '/users/{user}',
                scope: ToolDefinition::SCOPE_ADMIN,
                permissions: [AdminRole::USERS_READ],
            ),

            new ToolDefinition(
                name: 'admin_servers_list',
                description: 'List servers on the panel. Filter by owner_id to see everything one '
                    . 'customer has, or by name to find a specific server.',
                parameters: self::object([
                    'filter' => self::object([
                        'name' => self::string('Match on server name, partial matches allowed.'),
                        'owner_id' => self::string('Exact numeric id of the owning user.'),
                        'node_id' => self::string('Exact numeric node id.'),
                        'uuid' => self::string('Exact server uuid.'),
                    ]),
                    'per_page' => self::integer('Rows per page, 1 to 100. Defaults to 20.'),
                    'page' => self::integer('Page number, starting at 1.'),
                ]),
                method: 'GET',
                uriTemplate: self::BASE . '/servers',
                scope: ToolDefinition::SCOPE_ADMIN,
                permissions: [AdminRole::SERVERS_READ],
                resultShaper: fn (mixed $data) => self::mapList($data, fn (array $s) => [
                    'id' => $s['id'] ?? null,
                    'uuid' => $s['uuid'] ?? null,
                    'name' => $s['name'] ?? null,
                    'owner_id' => $s['user'] ?? ($s['owner_id'] ?? null),
                    'node_id' => $s['node'] ?? ($s['node_id'] ?? null),
                    'status' => $s['status'] ?? null,
                    'suspended' => $s['suspended'] ?? null,
                ], self::LIST_LIMIT),
                queryFields: ['filter', 'per_page', 'page'],
            ),

            new ToolDefinition(
                name: 'admin_server_view',
                description: 'Operational detail for one server, by numeric id — limits, node, owner and '
                    . 'install state. This is the panel\'s own record; it cannot read the server\'s '
                    . 'files or console. Point the customer at that server\'s own assistant for those.',
                parameters: self::object([
                    'server' => self::string('The numeric server id.'),
                ], ['server']),
                method: 'GET',
                uriTemplate: self::BASE . '/servers/{server}',
                scope: ToolDefinition::SCOPE_ADMIN,
                permissions: [AdminRole::SERVERS_READ],
                // The Application API representation also contains the full
                // container environment. It is useful to administrators in
                // the UI, but it includes hidden and dynamically configured
                // secrets and must never enter a provider payload. This is an
                // allowlist rather than a recursive blacklist so new response
                // fields remain excluded by default.
                resultShaper: fn (mixed $data) => self::mapItem($data, fn (array $s) => [
                    'id' => $s['id'] ?? null,
                    'uuid' => $s['uuid'] ?? null,
                    'identifier' => $s['identifier'] ?? null,
                    'name' => $s['name'] ?? null,
                    'description' => $s['description'] ?? null,
                    'status' => $s['status'] ?? null,
                    'limits' => $s['limits'] ?? null,
                    'feature_limits' => $s['feature_limits'] ?? null,
                    'owner_id' => $s['owner_id'] ?? null,
                    'node_id' => $s['node_id'] ?? null,
                    'allocation_id' => $s['allocation_id'] ?? null,
                    'nest_id' => $s['nest_id'] ?? null,
                    'egg_id' => $s['egg_id'] ?? null,
                    'billing_product_id' => $s['billing_product_id'] ?? null,
                    'renewal_date' => $s['renewal_date'] ?? null,
                    'is_deletion_scheduled' => $s['is_deletion_scheduled'] ?? false,
                    'created_at' => $s['created_at'] ?? null,
                    'updated_at' => $s['updated_at'] ?? null,
                ]),
            ),

            new ToolDefinition(
                name: 'admin_activity',
                description: 'Recent admin activity log entries — who changed what, and when.',
                parameters: self::object([
                    'per_page' => self::integer('Rows per page, 1 to 100. Defaults to 20.'),
                    'page' => self::integer('Page number, starting at 1.'),
                ]),
                method: 'GET',
                uriTemplate: self::BASE . '/activity',
                scope: ToolDefinition::SCOPE_ADMIN,
                permissions: [AdminRole::ACTIVITY_READ],
                resultShaper: fn (mixed $data) => self::mapList($data, fn (array $a) => [
                    'event' => $a['event'] ?? null,
                    'description' => $a['description'] ?? null,
                    'timestamp' => $a['timestamp'] ?? ($a['created_at'] ?? null),
                ], self::LIST_LIMIT),
                queryFields: ['per_page', 'page'],
            ),
        ];
    }

    /*
    |--------------------------------------------------------------------------
    | Billing — the product catalogue
    |--------------------------------------------------------------------------
    |
    | Categories are read-only here on purpose. Creating or editing one requires
    | an `eggId`, and eggs are deliberately outside the agent's reach, so the
    | model has no way to resolve a valid one — registering those tools would
    | only produce confident failures.
    */

    /**
     * @return ToolDefinition[]
     */
    private static function billing(): array
    {
        return [
            new ToolDefinition(
                name: 'admin_billing_analytics',
                description: 'Revenue and order totals for the billing module.',
                parameters: [],
                method: 'GET',
                uriTemplate: self::BASE . '/billing/analytics',
                scope: ToolDefinition::SCOPE_ADMIN,
                permissions: [AdminRole::BILLING_READ],
                group: self::GROUP_BILLING,
            ),

            new ToolDefinition(
                name: 'admin_categories_list',
                description: 'List product categories. Call this before creating or editing a product: '
                    . 'it returns both the numeric id the URL needs and the uuid the product record needs.',
                parameters: [],
                method: 'GET',
                uriTemplate: self::BASE . '/billing/categories',
                scope: ToolDefinition::SCOPE_ADMIN,
                permissions: [AdminRole::BILLING_READ],
                group: self::GROUP_BILLING,
                resultShaper: fn (mixed $data) => self::mapList($data, fn (array $c) => [
                    'id' => $c['id'] ?? null,
                    'uuid' => $c['uuid'] ?? null,
                    'name' => $c['name'] ?? null,
                    'description' => $c['description'] ?? null,
                    'visible' => $c['visible'] ?? null,
                ], self::LIST_LIMIT),
            ),

            new ToolDefinition(
                name: 'admin_products_list',
                description: 'List the products in one category.',
                parameters: self::object([
                    'category' => self::string('The numeric category id, from admin_categories_list.'),
                ], ['category']),
                method: 'GET',
                uriTemplate: self::BASE . '/billing/categories/{category}/products',
                scope: ToolDefinition::SCOPE_ADMIN,
                permissions: [AdminRole::BILLING_READ],
                group: self::GROUP_BILLING,
                resultShaper: fn (mixed $data) => self::mapList($data, fn (array $p) => [
                    'id' => $p['id'] ?? null,
                    'uuid' => $p['uuid'] ?? null,
                    'name' => $p['name'] ?? null,
                    'price' => $p['price'] ?? null,
                    'visible' => $p['visible'] ?? null,
                    'limits' => $p['limits'] ?? null,
                ], self::LIST_LIMIT),
            ),

            new ToolDefinition(
                name: 'admin_product_view',
                description: 'Full detail for one product, including its resource limits.',
                parameters: self::object([
                    'category' => self::string('The numeric category id.'),
                    'product' => self::string('The numeric product id.'),
                ], ['category', 'product']),
                method: 'GET',
                uriTemplate: self::BASE . '/billing/categories/{category}/products/{product}',
                scope: ToolDefinition::SCOPE_ADMIN,
                permissions: [AdminRole::BILLING_READ],
                group: self::GROUP_BILLING,
            ),

            new ToolDefinition(
                name: 'admin_cycles_list',
                description: 'The billing cycles (monthly, quarterly and so on) configured for a product, '
                    . 'with their price multipliers.',
                parameters: self::object([
                    'category' => self::string('The numeric category id.'),
                    'product' => self::string('The numeric product id.'),
                ], ['category', 'product']),
                method: 'GET',
                uriTemplate: self::BASE . '/billing/categories/{category}/products/{product}/billing-cycles',
                scope: ToolDefinition::SCOPE_ADMIN,
                permissions: [AdminRole::BILLING_READ],
                group: self::GROUP_BILLING,
                resultShaper: fn (mixed $data) => self::mapList($data, fn (array $c) => [
                    'id' => $c['id'] ?? null,
                    'cycle' => $c['billing_cycle'] ?? ($c['cycle'] ?? null),
                    'multiplier' => $c['multiplier'] ?? null,
                    'enabled' => $c['enabled'] ?? null,
                ], self::LIST_LIMIT),
            ),

            new ToolDefinition(
                name: 'admin_product_create',
                description: 'Create a product in a category. Every resource limit is required — read an '
                    . 'existing product in the same category first and follow its shape rather than '
                    . 'inventing limits. A limit of 0 means unlimited. The price is per month, in the '
                    . 'panel\'s configured currency.',
                parameters: self::object([
                    'category' => self::string('The numeric category id, from admin_categories_list.'),
                    'category_uuid' => self::string('That same category\'s uuid. Both are required.'),
                    'name' => self::string('Product name as customers will see it.'),
                    'description' => self::string('Short description shown on the storefront.'),
                    'price' => self::number('Monthly price.'),
                    'visible' => self::boolean('Whether it appears on the storefront. Defaults to visible.'),
                    'cpu_limit' => self::integer('CPU limit as a percentage. 100 is one core. 0 is unlimited.'),
                    'memory_limit' => self::integer('Memory limit in MB. 0 is unlimited.'),
                    'disk_limit' => self::integer('Disk limit in MB. 0 is unlimited.'),
                    'backup_limit' => self::integer('How many backups the server may keep.'),
                    'database_limit' => self::integer('How many databases the server may create.'),
                    'allocation_limit' => self::integer('How many ports the server may allocate.'),
                    'subdomain_limit' => self::integer('How many subdomains the server may claim.'),
                ], [
                    'category', 'category_uuid', 'name', 'price', 'cpu_limit', 'memory_limit',
                    'disk_limit', 'backup_limit', 'database_limit', 'allocation_limit',
                ]),
                method: 'POST',
                uriTemplate: self::BASE . '/billing/categories/{category}/products',
                risk: ToolDefinition::RISK_WRITE,
                scope: ToolDefinition::SCOPE_ADMIN,
                permissions: [AdminRole::BILLING_PRODUCTS_CREATE],
                group: self::GROUP_BILLING,
                bodyFields: [
                    'category_uuid', 'name', 'description', 'icon', 'price', 'visible',
                    'cpu_limit', 'memory_limit', 'disk_limit', 'backup_limit',
                    'database_limit', 'allocation_limit', 'subdomain_limit',
                ],
            ),

            new ToolDefinition(
                name: 'admin_product_update',
                description: 'Change fields on an existing product. Send only the fields you are changing; '
                    . 'anything omitted is left alone. Read the product first so you know what you are '
                    . 'changing it from.',
                parameters: self::object([
                    'category' => self::string('The numeric category id.'),
                    'product' => self::string('The numeric product id.'),
                    'name' => self::string('New product name.'),
                    'description' => [
                        'type' => ['string', 'null'],
                        'description' => 'New description, or null to clear it.',
                    ],
                    'icon' => [
                        'type' => ['string', 'null'],
                        'description' => 'New icon, or null to clear it.',
                    ],
                    'price' => self::number('New monthly price.'),
                    'visible' => self::boolean('Whether it appears on the storefront.'),
                    'cpu_limit' => self::integer('CPU limit as a percentage. 100 is one core.'),
                    'memory_limit' => self::integer('Memory limit in MB.'),
                    'disk_limit' => self::integer('Disk limit in MB.'),
                    'backup_limit' => self::integer('Backup allowance.'),
                    'database_limit' => self::integer('Database allowance.'),
                    'allocation_limit' => self::integer('Port allowance.'),
                    'subdomain_limit' => [
                        'type' => ['integer', 'null'],
                        'description' => 'Subdomain allowance, or null to inherit the category default.',
                    ],
                ], ['category', 'product']),
                method: 'PATCH',
                uriTemplate: self::BASE . '/billing/categories/{category}/products/{product}',
                risk: ToolDefinition::RISK_WRITE,
                scope: ToolDefinition::SCOPE_ADMIN,
                permissions: [AdminRole::BILLING_PRODUCTS_UPDATE],
                group: self::GROUP_BILLING,
                bodyFields: [
                    'name', 'description', 'icon', 'price', 'visible',
                    'cpu_limit', 'memory_limit', 'disk_limit', 'backup_limit',
                    'database_limit', 'allocation_limit', 'subdomain_limit',
                ],
            ),
        ];
    }

    /*
    |--------------------------------------------------------------------------
    | Commerce — coupons, orders, node pricing
    |--------------------------------------------------------------------------
    */

    /**
     * @return ToolDefinition[]
     */
    private static function commerce(): array
    {
        return [
            new ToolDefinition(
                name: 'admin_coupons_list',
                description: 'List discount coupons with their type, value, expiry and usage so far.',
                parameters: [],
                method: 'GET',
                uriTemplate: self::BASE . '/billing/coupons',
                scope: ToolDefinition::SCOPE_ADMIN,
                permissions: [AdminRole::BILLING_READ],
                group: self::GROUP_COMMERCE,
                resultShaper: fn (mixed $data) => self::mapList($data, fn (array $c) => [
                    'id' => $c['id'] ?? null,
                    'code' => $c['code'] ?? null,
                    'type' => $c['type'] ?? null,
                    'value' => $c['value'] ?? null,
                    'allowed_for' => $c['allowed_for'] ?? null,
                    'expires_at' => $c['expires_at'] ?? null,
                    'is_active' => $c['is_active'] ?? null,
                    'usage_count' => $c['usage_count'] ?? null,
                ], self::LIST_LIMIT),
            ),

            new ToolDefinition(
                name: 'admin_coupon_view',
                description: 'Full detail for one coupon, by numeric id.',
                parameters: self::object([
                    'coupon' => self::string('The numeric coupon id.'),
                ], ['coupon']),
                method: 'GET',
                uriTemplate: self::BASE . '/billing/coupons/{coupon}',
                scope: ToolDefinition::SCOPE_ADMIN,
                permissions: [AdminRole::BILLING_READ],
                group: self::GROUP_COMMERCE,
            ),

            new ToolDefinition(
                name: 'admin_coupon_create',
                description: 'Create a discount coupon. "percentage" values are a whole number out of 100; '
                    . '"fixed" values are an amount off. Use allowed_for to limit it to first purchases '
                    . 'or to renewals only.',
                parameters: self::object([
                    'code' => self::string('The code customers type, up to 50 characters. Must be unique.'),
                    'type' => self::enum(['percentage', 'fixed'], 'How the value is applied.'),
                    'value' => self::number('20 with type "percentage" means 20% off.'),
                    'allowed_for' => self::enum(
                        ['both', 'purchases', 'renewals'],
                        'What the coupon may be used on. Defaults to both.'
                    ),
                    'expires_at' => self::string('Expiry as a date, for example 2026-08-31. Omit for no expiry.'),
                    'max_uses' => self::integer('Total redemptions allowed across all customers.'),
                    'max_uses_per_user' => self::integer('Redemptions allowed per customer.'),
                    'min_order_total' => self::number('Minimum order value before the coupon applies.'),
                    'is_active' => self::boolean('Whether it can be redeemed straight away.'),
                ], ['code', 'type', 'value']),
                method: 'POST',
                uriTemplate: self::BASE . '/billing/coupons',
                risk: ToolDefinition::RISK_WRITE,
                scope: ToolDefinition::SCOPE_ADMIN,
                permissions: [AdminRole::BILLING_UPDATE],
                group: self::GROUP_COMMERCE,
                bodyFields: [
                    'code', 'type', 'value', 'allowed_for', 'expires_at',
                    'max_uses', 'max_uses_per_user', 'min_order_total', 'is_active',
                ],
            ),

            new ToolDefinition(
                name: 'admin_coupon_update',
                description: 'Change an existing coupon. Send only the fields you are changing. '
                    . 'Setting is_active to false is how you retire a coupon without deleting it.',
                parameters: self::object([
                    'coupon' => self::string('The numeric coupon id.'),
                    'code' => self::string('New code.'),
                    'type' => self::enum(['percentage', 'fixed'], 'How the value is applied.'),
                    'value' => self::number('New value.'),
                    'allowed_for' => self::enum(['both', 'purchases', 'renewals'], 'What it may be used on.'),
                    'expires_at' => self::string('New expiry date.'),
                    'max_uses' => self::integer('Total redemptions allowed.'),
                    'max_uses_per_user' => self::integer('Redemptions allowed per customer.'),
                    'min_order_total' => self::number('Minimum order value.'),
                    'is_active' => self::boolean('Whether it can be redeemed.'),
                ], ['coupon']),
                method: 'PATCH',
                uriTemplate: self::BASE . '/billing/coupons/{coupon}',
                risk: ToolDefinition::RISK_WRITE,
                scope: ToolDefinition::SCOPE_ADMIN,
                permissions: [AdminRole::BILLING_UPDATE],
                group: self::GROUP_COMMERCE,
                bodyFields: [
                    'code', 'type', 'value', 'allowed_for', 'expires_at',
                    'max_uses', 'max_uses_per_user', 'min_order_total', 'is_active',
                ],
            ),

            new ToolDefinition(
                name: 'admin_orders_list',
                description: 'Recent customer orders, newest first.',
                parameters: self::object([
                    'per_page' => self::integer('Rows per page, 1 to 100. Defaults to 20.'),
                    'page' => self::integer('Page number, starting at 1.'),
                ]),
                method: 'GET',
                uriTemplate: self::BASE . '/billing/orders',
                scope: ToolDefinition::SCOPE_ADMIN,
                permissions: [AdminRole::BILLING_ORDERS],
                group: self::GROUP_COMMERCE,
                resultShaper: fn (mixed $data) => self::mapList($data, fn (array $o) => [
                    'id' => $o['id'] ?? null,
                    'user_id' => $o['user_id'] ?? null,
                    'total' => $o['total'] ?? null,
                    'status' => $o['status'] ?? null,
                    'created_at' => $o['created_at'] ?? null,
                ], self::LIST_LIMIT),
                queryFields: ['per_page', 'page'],
            ),

            new ToolDefinition(
                name: 'admin_node_pricing_list',
                description: 'Per-node price multipliers. A multiplier of 1.0 means a node charges the '
                    . 'catalogue price.',
                parameters: [],
                method: 'GET',
                uriTemplate: self::BASE . '/billing/node-pricing',
                scope: ToolDefinition::SCOPE_ADMIN,
                permissions: [AdminRole::BILLING_READ],
                group: self::GROUP_COMMERCE,
                resultShaper: fn (mixed $data) => self::mapList($data, fn (array $n) => [
                    'id' => $n['id'] ?? ($n['node_id'] ?? null),
                    'name' => $n['name'] ?? null,
                    'multiplier' => $n['multiplier'] ?? null,
                ], self::LIST_LIMIT),
            ),

            new ToolDefinition(
                name: 'admin_node_pricing_update',
                description: 'Set one node\'s price multiplier. This changes what every product costs on '
                    . 'that node, so say what the effect will be before proposing it.',
                parameters: self::object([
                    'id' => self::string('The numeric node id.'),
                    'multiplier' => self::number('1.0 is catalogue price; 1.25 is 25% more.'),
                ], ['id', 'multiplier']),
                method: 'PATCH',
                uriTemplate: self::BASE . '/billing/node-pricing/{id}',
                risk: ToolDefinition::RISK_WRITE,
                scope: ToolDefinition::SCOPE_ADMIN,
                permissions: [AdminRole::BILLING_UPDATE],
                group: self::GROUP_COMMERCE,
                bodyFields: ['multiplier'],
            ),
        ];
    }

    /*
    |--------------------------------------------------------------------------
    | Support — read-only
    |--------------------------------------------------------------------------
    |
    | Drafting replies (tickets.message) is deliberately absent: it writes text
    | under an administrator's name to a customer, which is not something to
    | hand a model on its first outing.
    */

    /**
     * @return ToolDefinition[]
     */
    private static function support(): array
    {
        return [
            new ToolDefinition(
                name: 'admin_tickets_list',
                description: 'List support tickets. Filter by status to find what still needs attention.',
                parameters: self::object([
                    'filter' => self::object([
                        'status' => self::string('Exact ticket status.'),
                        'priority' => self::string('Exact ticket priority.'),
                        'title' => self::string('Match on title, partial matches allowed.'),
                    ]),
                    'per_page' => self::integer('Rows per page, 1 to 100. Defaults to 20.'),
                    'page' => self::integer('Page number, starting at 1.'),
                ]),
                method: 'GET',
                uriTemplate: self::BASE . '/tickets',
                scope: ToolDefinition::SCOPE_ADMIN,
                permissions: [AdminRole::TICKETS_READ],
                group: self::GROUP_SUPPORT,
                resultShaper: fn (mixed $data) => self::mapList($data, fn (array $t) => [
                    'id' => $t['id'] ?? null,
                    'title' => $t['title'] ?? null,
                    'status' => $t['status'] ?? null,
                    'priority' => $t['priority'] ?? null,
                    // The transformer nests the whole user record rather than
                    // emitting a flat user_id, so the id is read out of it —
                    // reading `user_id` here would hand the model a column of
                    // nulls and it would go looking for the reporter by name.
                    'user_id' => $t['user']['id'] ?? ($t['user_id'] ?? null),
                    // Null on every ticket raised before the field existed, and
                    // on any raised since through a form that does not ask. The
                    // agent is told to fall back to the reporter's server list
                    // rather than treating a null as "no server involved".
                    'server_id' => $t['server_id'] ?? null,
                    'last_reply_at' => $t['last_reply_at'] ?? null,
                ], self::LIST_LIMIT),
                queryFields: ['filter', 'per_page', 'page'],
            ),

            new ToolDefinition(
                name: 'admin_ticket_view',
                description: 'Full detail for one ticket, by numeric id. If server_id is set the '
                    . 'customer told us which server the ticket is about; if it is null, look up '
                    . 'what servers the reporting user owns instead.',
                parameters: self::object([
                    'ticket' => self::string('The numeric ticket id.'),
                ], ['ticket']),
                method: 'GET',
                uriTemplate: self::BASE . '/tickets/{ticket}',
                scope: ToolDefinition::SCOPE_ADMIN,
                permissions: [AdminRole::TICKETS_READ],
                group: self::GROUP_SUPPORT,
            ),

            new ToolDefinition(
                name: 'admin_ticket_messages',
                description: 'The conversation on one ticket, oldest first.',
                parameters: self::object([
                    'ticket' => self::string('The numeric ticket id.'),
                ], ['ticket']),
                method: 'GET',
                uriTemplate: self::BASE . '/tickets/{ticket}/messages',
                scope: ToolDefinition::SCOPE_ADMIN,
                permissions: [AdminRole::TICKETS_READ],
                group: self::GROUP_SUPPORT,
                resultShaper: fn (mixed $data) => self::mapList($data, fn (array $m) => [
                    // As on the listing, the author arrives nested. The username
                    // is kept rather than only the id because a ticket thread
                    // reads as a conversation and "who said this" is most of
                    // what makes it diagnosable.
                    'author_id' => $m['author']['id'] ?? ($m['user_id'] ?? null),
                    'author' => $m['author']['username'] ?? null,
                    'internal_note' => $m['internal_note'] ?? false,
                    'message' => $m['message'] ?? null,
                    'created_at' => $m['created_at'] ?? null,
                ], self::LIST_LIMIT),
            ),

            new ToolDefinition(
                name: self::ASSIST_SERVER,
                description: 'Open a read-only diagnostic session on one customer\'s server, so you can '
                    . 'look at its files, startup settings and current state the way its owner could. '
                    . 'Use this when a ticket is about a specific server and you cannot answer it from '
                    . 'the panel\'s own records. The administrator has to approve it, and the customer '
                    . 'sees it in their activity log, so give a reason that would make sense to them. '
                    . 'You cannot change anything with this — ask for writes separately if a fix needs one.',
                parameters: self::object([
                    'server' => self::string('The server\'s numeric id or uuid, from admin_servers_list.'),
                    'reason' => self::string(
                        'One line on why you need to look, in plain language. This is shown to the '
                        . 'administrator on the approval and written to the customer\'s activity log.'
                    ),
                    'ticket' => self::integer('The ticket id this is about, when there is one.'),
                ], ['server', 'reason']),
                method: '',
                uriTemplate: '',
                // WRITE rather than SAFE despite reading nothing itself: what it
                // does is grant access to somebody else's data, and that is a
                // decision a person makes, not a step the model takes.
                risk: ToolDefinition::RISK_WRITE,
                scope: ToolDefinition::SCOPE_ADMIN,
                permissions: [AdminRole::SERVERS_ASSIST],
                group: self::GROUP_SUPPORT,
                hostHandled: true,
            ),

            new ToolDefinition(
                name: self::ASSIST_ALLOW_WRITES,
                description: 'Ask to be allowed to change the server you are currently assisting — '
                    . 'editing a config file, changing a startup variable, restarting it. Only ask '
                    . 'once you have found the problem and can say exactly what you would change and '
                    . 'why. The administrator approves this separately from the session itself.',
                parameters: self::object([
                    'reason' => self::string('What you want to change and why, in one or two sentences.'),
                ], ['reason']),
                method: '',
                uriTemplate: '',
                risk: ToolDefinition::RISK_WRITE,
                scope: ToolDefinition::SCOPE_ADMIN,
                permissions: [AdminRole::SERVERS_ASSIST],
                group: self::GROUP_SUPPORT,
                hostHandled: true,
            ),
        ];
    }

    /*
    |--------------------------------------------------------------------------
    | Panel — read-only
    |--------------------------------------------------------------------------
    */

    /**
     * @return ToolDefinition[]
     */
    private static function panel(): array
    {
        return [
            new ToolDefinition(
                name: 'admin_features',
                description: 'Which panel modules are switched on. Check this before telling someone a '
                    . 'feature is missing — it may simply be disabled.',
                parameters: [],
                method: 'GET',
                uriTemplate: self::BASE . '/settings/features',
                scope: ToolDefinition::SCOPE_ADMIN,
                permissions: [AdminRole::SETTINGS_READ],
                group: self::GROUP_PANEL,
            ),

            new ToolDefinition(
                name: 'admin_presets_list',
                description: 'Server presets — the saved configurations an admin can create a server from.',
                parameters: [],
                method: 'GET',
                uriTemplate: self::BASE . '/servers/presets',
                scope: ToolDefinition::SCOPE_ADMIN,
                permissions: [AdminRole::SERVER_PRESETS_READ],
                group: self::GROUP_PANEL,
                resultShaper: fn (mixed $data) => self::mapList($data, fn (array $p) => [
                    'id' => $p['id'] ?? null,
                    'name' => $p['name'] ?? null,
                    'description' => $p['description'] ?? null,
                ], self::LIST_LIMIT),
            ),
        ];
    }
}

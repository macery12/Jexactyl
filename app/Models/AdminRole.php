<?php

namespace Everest\Models;

use Illuminate\Support\Collection;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * @property int $id
 * @property string $name
 * @property string|null $description
 * @property int $sort_id
 * @property array $permissions
 * @property bool $is_system
 * @property bool $is_owner
 * @property bool $api_eligible
 * @property int|null $users_count
 * @property int|null $application_keys_count
 */
class AdminRole extends Model
{
    /**
     * The resource name for this model when it is transformed into an
     * API representation using fractal.
     */
    public const RESOURCE_NAME = 'admin_role';

    /**
     * The table associated with the model.
     */
    protected $table = 'admin_roles';

    /**
     * Fields that are mass assignable.
     */
    protected $fillable = [
        'name',
        'description',
        'sort_id',
        'permissions',
        'color',
        'api_eligible',
    ];

    /**
     * Cast values to correct type.
     */
    protected $casts = [
        'sort_id' => 'int',
        'permissions' => 'array',
        'is_system' => 'bool',
        'is_owner' => 'bool',
        'api_eligible' => 'bool',
    ];

    public static array $validationRules = [
        'name' => 'required|string|max:64',
        'description' => 'nullable|string|max:255',
        'sort_id' => 'sometimes|numeric',
        'permissions' => 'nullable|array',
        'color' => 'nullable|string',
        'api_eligible' => 'sometimes|boolean',
    ];

    public $timestamps = false;

    /**
     * The list of constants from self::$permissions.
     */
    public const OVERVIEW_READ = 'overview.read';

    public const SETTINGS_READ = 'settings.read';
    public const SETTINGS_UPDATE = 'settings.update';

    public const ACTIVITY_READ = 'activity.read';

    public const QUEUES_READ = 'queues.read';
    public const QUEUES_RETRY = 'queues.retry';
    public const QUEUES_DELETE = 'queues.delete';

    public const API_READ = 'api.read';
    public const API_CREATE = 'api.create';
    public const API_DELETE = 'api.delete';

    public const AUTH_READ = 'auth.read';
    public const AUTH_CREATE = 'auth.create';
    public const AUTH_UPDATE = 'auth.update';
    public const AUTH_DELETE = 'auth.delete';

    public const BILLING_READ = 'billing.read';
    public const BILLING_PRODUCTS_CREATE = 'billing.products-create';
    public const BILLING_PRODUCTS_UPDATE = 'billing.products-update';
    public const BILLING_PRODUCTS_DELETE = 'billing.products-delete';
    public const BILLING_CATEGORIES_CREATE = 'billing.categories-create';
    public const BILLING_CATEGORIES_UPDATE = 'billing.categories-update';
    public const BILLING_CATEGORIES_DELETE = 'billing.categories-delete';
    public const BILLING_ORDERS = 'billing.orders';
    public const BILLING_EXCEPTIONS = 'billing.exceptions';
    public const BILLING_UPDATE = 'billing.update';
    public const BILLING_EXPORT = 'billing.export';
    public const BILLING_IMPORT = 'billing.import';
    public const BILLING_DELETE_KEYS = 'billing.delete-keys';

    public const TICKETS_READ = 'tickets.read';
    public const TICKETS_CREATE = 'tickets.create';
    public const TICKETS_UPDATE = 'tickets.update';
    public const TICKETS_DELETE = 'tickets.delete';
    public const TICKETS_MESSAGE = 'tickets.message';

    public const AI_READ = 'ai.read';
    public const AI_UPDATE = 'ai.update';

    public const MODS_READ = 'mods.read';
    public const MODS_UPDATE = 'mods.update';

    public const EMAIL_READ = 'email.read';
    public const EMAIL_UPDATE = 'email.update';
    public const EMAIL_SEND = 'email.send';

    public const WEBHOOKS_READ = 'webhooks.read';
    public const WEBHOOKS_UPDATE = 'webhooks.update';

    public const ALERTS_READ = 'alerts.read';
    public const ALERTS_UPDATE = 'alerts.update';

    public const THEME_READ = 'theme.read';
    public const THEME_UPDATE = 'theme.update';

    public const LINKS_READ = 'links.read';
    public const LINKS_CREATE = 'links.create';
    public const LINKS_UPDATE = 'links.update';
    public const LINKS_DELETE = 'links.delete';

    public const DATABASES_READ = 'databases.read';
    public const DATABASES_CREATE = 'databases.create';
    public const DATABASES_UPDATE = 'databases.update';
    public const DATABASES_DELETE = 'databases.delete';

    public const ALLOCATIONS_READ = 'allocations.read';
    public const ALLOCATIONS_CREATE = 'allocations.create';
    public const ALLOCATIONS_DELETE = 'allocations.delete';

    public const LOCATIONS_READ = 'locations.read';
    public const LOCATIONS_UPDATE = 'locations.update';

    public const SERVER_DATABASES_READ = 'server-databases.read';
    public const SERVER_DATABASES_CREATE = 'server-databases.create';
    public const SERVER_DATABASES_UPDATE = 'server-databases.update';
    public const SERVER_DATABASES_DELETE = 'server-databases.delete';

    public const NODES_READ = 'nodes.read';
    public const NODES_CREATE = 'nodes.create';
    public const NODES_UPDATE = 'nodes.update';
    public const NODES_DELETE = 'nodes.delete';

    public const SERVERS_READ = 'servers.read';
    public const SERVERS_CREATE = 'servers.create';
    public const SERVERS_UPDATE = 'servers.update';
    public const SERVERS_DELETE = 'servers.delete';

    /**
     * Read a customer's server through an audited AI assist session.
     *
     * Deliberately separate from `servers.update`, which edits the panel's own
     * record of a server. This one reaches inside it — the files, the startup
     * variables, the console — so it is the one capability that lets a
     * non-Owner past `AuthenticateServerAccess`, and it should be granted like
     * that fact is true.
     */
    public const SERVERS_ASSIST = 'servers.assist';

    public const SERVER_PRESETS_READ = 'server-presets.read';
    public const SERVER_PRESETS_CREATE = 'server-presets.create';
    public const SERVER_PRESETS_UPDATE = 'server-presets.update';
    public const SERVER_PRESETS_DELETE = 'server-presets.delete';

    public const USERS_READ = 'users.read';
    public const USERS_CREATE = 'users.create';
    public const USERS_UPDATE = 'users.update';
    public const USERS_DELETE = 'users.delete';

    public const ROLES_READ = 'roles.read';
    public const ROLES_CREATE = 'roles.create';
    public const ROLES_UPDATE = 'roles.update';
    public const ROLES_DELETE = 'roles.delete';

    public const NESTS_READ = 'nests.read';
    public const NESTS_CREATE = 'nests.create';
    public const NESTS_UPDATE = 'nests.update';
    public const NESTS_DELETE = 'nests.delete';

    public const EGGS_READ = 'eggs.read';
    public const EGGS_CREATE = 'eggs.create';
    public const EGGS_UPDATE = 'eggs.update';
    public const EGGS_DELETE = 'eggs.delete';
    public const EGGS_IMPORT = 'eggs.import';
    public const EGGS_EXPORT = 'eggs.export';

    public const MOUNTS_READ = 'mounts.read';
    public const MOUNTS_CREATE = 'mounts.create';
    public const MOUNTS_UPDATE = 'mounts.update';
    public const MOUNTS_DELETE = 'mounts.delete';

    public const EXTENSIONS_READ = 'extensions.read';
    public const EXTENSIONS_INSTALL = 'extensions.install';
    public const EXTENSIONS_UPDATE = 'extensions.update';
    public const EXTENSIONS_DELETE = 'extensions.delete';
    public const EXTENSIONS_REPOSITORIES = 'extensions.repositories';

    public const CUSTOM_DOMAINS_READ = 'custom-domains.read';
    public const CUSTOM_DOMAINS_CREATE = 'custom-domains.create';
    public const CUSTOM_DOMAINS_UPDATE = 'custom-domains.update';
    public const CUSTOM_DOMAINS_DELETE = 'custom-domains.delete';

    /**
     * All the permissions available on the system. You should use self::permissions()
     * to retrieve them, and not directly access this array as it is subject to change.
     *
     * @see Permission::permissions()
     */
    protected static array $permissions = [
        'overview' => [
            'description' => 'Permissions to allow administrator to view the index page.',
            'keys' => [
                'read' => 'Read the contents of the overview.',
            ],
        ],
        'settings' => [
            'description' => 'Permissions to allow changing basic admin settings.',
            'keys' => [
                'read' => 'Read the panel settings.',
                'update' => 'Update the panel settings.',
            ],
        ],
        'activity' => [
            'description' => 'Permissions to allow admins to see activity logs.',
            'keys' => [
                'read' => 'View the admin activity logs.',
            ],
        ],
        'queues' => [
            'description' => 'Permissions to inspect background workers and recover failed jobs.',
            'keys' => [
                'read' => 'View queue health, worker status, and the failed-job list.',
                'retry' => 'Re-dispatch a failed job onto its queue.',
                'delete' => 'Discard failed jobs. The payload is destroyed with the record.',
            ],
        ],
        'api' => [
            'description' => 'Permissions to configure Application API keys.',
            'keys' => [
                'read' => 'View the existing Application API keys.',
                'create' => 'Create a new Application API key.',
                'delete' => 'Delete Application API keys.',
            ],
        ],
        'auth' => [
            'description' => 'Permissions to configure the Authentication module.',
            'keys' => [
                'read' => 'View the current authentication settings.',
                'create' => 'Enable authentication modules.',
                'update' => 'Update authentication module settings.',
                'delete' => 'Disable authentication modules.',
            ],
        ],
        'billing' => [
            'description' => 'Permissions to configure the Billing module.',
            'keys' => [
                'read' => 'Read basic billing information.',
                'orders' => 'Read all user orders on the system.',
                'products-create' => 'Create a billing product.',
                'products-update' => 'Update a billing product.',
                'products-delete' => 'Delete a billing product.',
                'categories-create' => 'Create a billing category.',
                'categories-update' => 'Update a billing category.',
                'categories-delete' => 'Delete a billing category.',
                'exceptions' => 'Manage and resolve billing exceptions.',
                'update' => 'Update billing settings.',
                'export' => 'Export current billing configuration to JSON.',
                'import' => 'Import current billing configuration from JSON.',
                'delete-keys' => 'Delete payment provider API keys (Stripe, PayPal, etc.).',
            ],
        ],
        'tickets' => [
            'description' => 'Permissions to configure the Ticket module.',
            'keys' => [
                'read' => 'View all existing tickets.',
                'create' => 'Create a new ticket.',
                'update' => 'Update an existing ticket.',
                'delete' => 'Delete an existing ticket.',
                'message' => 'Send a message in a ticket.',
            ],
        ],
        'ai' => [
            'description' => 'Permissions to configure the AI module.',
            'keys' => [
                'read' => 'View the Admin AI console.',
                'update' => 'Control the AI settings.',
            ],
        ],
        'mods' => [
            'description' => 'Permissions to configure the Mods module.',
            'keys' => [
                'read' => 'View the Mods module analytics and settings.',
                'update' => 'Control the Mods module settings and API keys.',
            ],
        ],
        'email' => [
            'description' => 'Permissions to configure the Email system.',
            'keys' => [
                'read' => 'View the email configuration.',
                'update' => 'Update email settings.',
                'send' => 'Send custom emails.',
            ],
        ],
        'webhooks' => [
            'description' => 'Permissions to configure the Webhook system.',
            'keys' => [
                'read' => 'View all available webhooks.',
                'update' => 'Control the AI settings.',
            ],
        ],
        'alerts' => [
            'description' => 'Permissions to configure Alerts.',
            'keys' => [
                'read' => 'View the alert configuration.',
                'update' => 'Control the alert settings.',
            ],
        ],
        'theme' => [
            'description' => 'Permissions to configure the panel theme.',
            'keys' => [
                'read' => 'View the current theme settings.',
                'update' => 'Adjust the panel theme.',
            ],
        ],
        'links' => [
            'description' => 'Permissions to configure external links.',
            'keys' => [
                'read' => 'View the current links.',
                'create' => 'Create a new link.',
                'update' => 'Update an existing link.',
                'delete' => 'Delete an existing link.',
            ],
        ],
        'databases' => [
            'description' => 'Permissions to configure database hosts.',
            'keys' => [
                'read' => 'View the current database hosts.',
                'create' => 'Create a new database host.',
                'update' => 'Update an existing database host.',
                'delete' => 'Delete an existing database host.',
            ],
        ],
        'allocations' => [
            'description' => 'Permissions to manage node allocations.',
            'keys' => [
                'read' => 'View node allocations.',
                'create' => 'Create node allocations.',
                'delete' => 'Delete node allocations.',
            ],
        ],
        'server-databases' => [
            'description' => 'Permissions to manage databases assigned to servers.',
            'keys' => [
                'read' => 'View server databases.',
                'create' => 'Create server databases.',
                'update' => 'Update server databases and rotate credentials.',
                'delete' => 'Delete server databases.',
            ],
        ],
        'nodes' => [
            'description' => 'Permissions to configure nodes.',
            'keys' => [
                'read' => 'View the current nodes.',
                'create' => 'Create a new node.',
                'update' => 'Update an existing node.',
                'delete' => 'Delete an existing node.',
            ],
        ],
        'servers' => [
            'description' => 'Permissions to configure servers.',
            'keys' => [
                'read' => 'View the current servers.',
                'create' => 'Create a new server.',
                'update' => 'Update an existing server.',
                'delete' => 'Delete an existing server.',
                'assist' => 'Diagnose a customer\'s server with the AI assistant, reading its files and startup settings. Every session is approved first and logged to the customer\'s own activity feed.',
            ],
        ],
        'server-presets' => [
            'description' => 'Permissions to configure server presets.',
            'keys' => [
                'read' => 'View the current server presets.',
                'create' => 'Create a new server preset.',
                'update' => 'Update an existing server preset.',
                'delete' => 'Delete an existing server preset.',
            ],
        ],
        'users' => [
            'description' => 'Permissions to configure users.',
            'keys' => [
                'read' => 'View the current users.',
                'create' => 'Create a new user.',
                'update' => 'Update an existing user.',
                'delete' => 'Delete an existing user.',
            ],
        ],
        'roles' => [
            'description' => 'Permissions to configure admin roles.',
            'keys' => [
                'read' => 'View the current admin roles.',
                'create' => 'Create a new admin role.',
                'update' => 'Update an existing admin role.',
                'delete' => 'Delete an existing admin role.',
            ],
        ],
        'nests' => [
            'description' => 'Permissions to configure nests.',
            'keys' => [
                'read' => 'View the current nests.',
                'create' => 'Create a new nest.',
                'update' => 'Update an existing nest.',
                'delete' => 'Delete an existing nest.',
            ],
        ],
        'eggs' => [
            'description' => 'Permissions to configure eggs.',
            'keys' => [
                'read' => 'View the current eggs.',
                'create' => 'Create a new egg.',
                'update' => 'Update an existing egg.',
                'delete' => 'Delete an existing egg.',
                'import' => 'Import an egg to an existing nest via JSON.',
                'export' => 'Export an egg via JSON.',
            ],
        ],
        'extensions' => [
            'description' => 'Permissions to configure extensions.',
            'keys' => [
                'read' => 'View the current extensions and repositories.',
                'install' => 'Install or update an extension.',
                'update' => 'Update extension settings or toggle extensions.',
                'delete' => 'Uninstall an extension.',
                'repositories' => 'Add, edit, or remove extension repositories.',
            ],
        ],
        'custom-domains' => [
            'description' => 'Permissions to configure the Custom Domains module.',
            'keys' => [
                'read' => 'View custom domains, Cloudflare API keys, and settings.',
                'create' => 'Create a new custom domain.',
                'update' => 'Update a custom domain, API key, or module settings.',
                'delete' => 'Delete a custom domain or API key.',
            ],
        ],
    ];

    /**
     * Gets the permissions associated with an admin role.
     */
    public static function permissions(): Collection
    {
        return Collection::make(self::$permissions);
    }

    /**
     * People this profile is assigned to. Deleting a profile is blocked while
     * any of these exist, so the panel surfaces the count before the attempt.
     */
    public function users(): HasMany
    {
        return $this->hasMany(User::class, 'admin_role_id');
    }

    /**
     * Application API keys bound to this profile. Scoped to the application key
     * type — account keys carry no admin_role_id and must never be counted here.
     */
    public function applicationKeys(): HasMany
    {
        return $this->hasMany(ApiKey::class, 'admin_role_id')
            ->where('key_type', ApiKey::TYPE_APPLICATION);
    }

    /**
     * The built-in Owner profile is the sole source of unrestricted authority.
     */
    public function isOwner(): bool
    {
        return (bool) $this->is_owner;
    }

    public function isProtected(): bool
    {
        return (bool) $this->is_system;
    }
}

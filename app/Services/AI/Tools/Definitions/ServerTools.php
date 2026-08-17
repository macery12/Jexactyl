<?php

namespace Everest\Services\AI\Tools\Definitions;

use Everest\Models\Permission;
use Everest\Services\AI\Tools\ToolDefinition;

/**
 * The server-scoped toolset.
 *
 * Every URI here interpolates `{server}` from the turn's bound context. None
 * of the argument schemas accept a server identifier, so a hallucinated or
 * prompt-injected one has nowhere to land — that structural property, not a
 * validation rule, is what confines the agent to one server.
 *
 * Tools without a group form the base set that is always offered. The rest sit
 * behind groups the agent activates on demand, because small local models
 * degrade sharply once too many tools are in play.
 *
 * The split is by *what a tool does to the server*, not by feature area. An
 * earlier arrangement grouped by area — backups, databases, network, mods — and
 * the effect was that reading the port list needed an activation step while
 * deleting a directory did not: nine of the fourteen always-offered tools wrote
 * to the server, and seven of the twelve read-only ones were gated. Most
 * questions a user actually asks ("what port am I on", "do I have backups",
 * "which plugins are installed") are answered by a single cheap read, so a read
 * is never worth a round trip to unlock. Reads are also the tools whose results
 * make the following write correct, and an agent that cannot look is left
 * guessing at exactly the moment it is about to change something.
 *
 * So: every read is always offered, along with the writes common enough that
 * gating them would cost a step on most turns. What is left behind a group is
 * the rarer, heavier writes — and those already stop for an approval, so the
 * activation call lands on a turn that was going to pause anyway.
 */
class ServerTools
{
    use DefinesToolSchemas;

    public const GROUP_FILES_EDIT = 'files_edit';
    public const GROUP_BACKUPS = 'backups';

    /**
     * Each description says what the group does *not* cover, because the
     * failure mode is not a model that misses a group — it is one that spends a
     * step activating "backups" to answer "do I have any", which it could
     * already do.
     */
    public const GROUP_DESCRIPTIONS = [
        self::GROUP_FILES_EDIT => 'Create, rename, copy, delete, compress and extract files. '
            . 'Not needed to list, read or edit a file — those tools you already have.',
        self::GROUP_BACKUPS => 'Create, restore and delete backups. '
            . 'Not needed to list them — backups_list you already have.',
    ];

    private const BASE = '/api/client/servers/{server}';

    /**
     * Ordered most-useful-first: an operator who lowers `max_tools` for a small
     * model truncates the tail, so the tail is where the least-reached-for tools
     * belong.
     *
     * @return ToolDefinition[]
     */
    public static function all(): array
    {
        return array_merge(
            self::core(),
            self::files(),
            self::inspect(),
            self::fileEdits(),
            self::backupWrites(),
        );
    }

    /*
    |--------------------------------------------------------------------------
    | Core
    |--------------------------------------------------------------------------
    */

    /**
     * @return ToolDefinition[]
     */
    private static function core(): array
    {
        return [
            new ToolDefinition(
                name: 'server_status',
                description: 'Get the server\'s current state and live resource usage (CPU, memory, disk, uptime). Use this first when diagnosing a problem.',
                parameters: self::object([]),
                method: 'GET',
                uriTemplate: self::BASE . '/resources',
                permissions: [Permission::ACTION_WEBSOCKET_CONNECT],
                resultShaper: static function (mixed $data) {
                    $attrs = $data['attributes'] ?? [];
                    $resources = $attrs['resources'] ?? [];

                    return [
                        'state' => $attrs['current_state'] ?? 'unknown',
                        'suspended' => (bool) ($attrs['is_suspended'] ?? false),
                        'cpu_percent' => $resources['cpu_absolute'] ?? null,
                        'memory_bytes' => $resources['memory_bytes'] ?? null,
                        'disk_bytes' => $resources['disk_bytes'] ?? null,
                        'uptime_ms' => $resources['uptime'] ?? null,
                    ];
                },
            ),

            new ToolDefinition(
                name: 'server_power',
                description: 'Send a power action to the server. Use "restart" after changing a config file so the change takes effect. You may hold permission for only some of these signals; the panel refuses the rest.',
                parameters: self::object([
                    'signal' => self::enum(['start', 'stop', 'restart', 'kill'], 'The power action. "kill" force-stops without saving and risks world corruption.'),
                ], ['signal']),
                method: 'POST',
                uriTemplate: self::BASE . '/power',
                risk: ToolDefinition::RISK_WRITE,
                // `SendPowerRequest::permission()` resolves per signal — start,
                // stop/kill and restart are three separate permissions — so this
                // is offered to anyone holding any of them and the endpoint
                // decides each call. Requiring `control.restart` flatly, as it
                // used to, hid the tool from every start-only or stop-only user
                // while advertising all four signals to a restart-only one.
                anyPermission: [
                    Permission::ACTION_CONTROL_START,
                    Permission::ACTION_CONTROL_STOP,
                    Permission::ACTION_CONTROL_RESTART,
                ],
                bodyFields: ['signal'],
                resultShaper: static fn () => ['sent' => true],
            ),

            new ToolDefinition(
                name: 'console_send',
                description: 'Send a single command to the running server console. The server must be online. Prefer editing config files for persistent changes; use this for runtime commands like reloading a plugin.',
                parameters: self::object([
                    'command' => self::string('The command to send, without a leading slash.'),
                ], ['command']),
                method: 'POST',
                uriTemplate: self::BASE . '/command',
                // The effective tier is decided per-command by the console
                // gate: recognised informational commands stay at WRITE,
                // everything else escalates to typed confirmation.
                risk: ToolDefinition::RISK_WRITE,
                permissions: [Permission::ACTION_CONTROL_CONSOLE],
                bodyFields: ['command'],
                resultShaper: static fn () => ['sent' => true],
            ),

            new ToolDefinition(
                name: 'activity_recent',
                description: 'List recent activity on this server (who changed what, and when). Useful for working out what caused a regression.',
                parameters: self::object([]),
                method: 'GET',
                uriTemplate: self::BASE . '/activity',
                permissions: [Permission::ACTION_ACTIVITY_READ],
                resultShaper: static fn (mixed $data) => self::mapList(
                    $data,
                    static fn (array $a) => [
                        'event' => $a['event'] ?? null,
                        'actor' => $a['actor_uuid'] ?? null,
                        'at' => $a['timestamp'] ?? null,
                    ],
                    25
                ),
            ),

            new ToolDefinition(
                name: 'startup_list',
                description: 'List the server\'s startup variables and their current values, plus the resolved startup command. Many game and modpack settings live here rather than in a config file.',
                parameters: self::object([]),
                method: 'GET',
                uriTemplate: self::BASE . '/startup',
                permissions: [Permission::ACTION_STARTUP_READ],
                resultShaper: static function (mixed $data) {
                    $variables = self::mapList(
                        $data,
                        static fn (array $a) => [
                            'key' => $a['env_variable'] ?? null,
                            'name' => $a['name'] ?? null,
                            'value' => $a['server_value'] ?? null,
                            'editable' => (bool) ($a['is_editable'] ?? false),
                            'rules' => $a['rules'] ?? null,
                        ],
                        60
                    );

                    return [
                        'variables' => $variables,
                        'startup_command' => $data['meta']['startup_command'] ?? null,
                        // Singular is the image in use; plural is the egg's
                        // allowlist, keyed by the label the panel shows. These
                        // were one key once, and a model reading "docker_image"
                        // as the current image when it was really the map had
                        // no way to tell it had been misled.
                        'docker_image' => $data['meta']['docker_image'] ?? null,
                        'docker_images' => $data['meta']['docker_images'] ?? null,
                    ];
                },
            ),

            new ToolDefinition(
                name: 'startup_set',
                description: 'Change one startup variable. Only variables reported as editable by startup_list can be changed; the egg\'s own validation rules still apply. The Docker image is not a startup variable — use startup_image_set for that.',
                parameters: self::object([
                    'key' => self::string('The variable key, exactly as returned by startup_list.'),
                    'value' => self::string('The new value.'),
                ], ['key', 'value']),
                method: 'PUT',
                uriTemplate: self::BASE . '/startup/variable',
                risk: ToolDefinition::RISK_WRITE,
                permissions: [Permission::ACTION_STARTUP_UPDATE],
                bodyFields: ['key', 'value'],
                resultShaper: static fn (mixed $data) => [
                    'key' => $data['attributes']['env_variable'] ?? null,
                    'value' => $data['attributes']['server_value'] ?? null,
                ],
            ),

            new ToolDefinition(
                name: 'startup_image_set',
                description: 'Change the Docker image the server runs in. This is what decides the runtime version — a Minecraft 1.12 server on a Java 19 image will not boot, and the fix is this tool, not a startup variable. Pass one of the values from startup_list\'s docker_images map, exactly as written; a value outside that map is refused. The change takes effect on the next start, so restart afterwards.',
                parameters: self::object([
                    'docker_image' => self::string('The image to switch to — a value from startup_list\'s docker_images map, not the label beside it.'),
                ], ['docker_image']),
                method: 'PUT',
                uriTemplate: self::BASE . '/settings/docker-image',
                risk: ToolDefinition::RISK_WRITE,
                // Its own permission, separate from startup.update: a subuser
                // who may edit variables is not thereby allowed to change the
                // runtime out from under the server.
                permissions: [Permission::ACTION_STARTUP_DOCKER_IMAGE],
                bodyFields: ['docker_image'],
                // 204, so there is no body to shape.
                resultShaper: static fn () => ['updated' => true],
            ),
        ];
    }

    /*
    |--------------------------------------------------------------------------
    | Files
    |--------------------------------------------------------------------------
    */

    /**
     * @return ToolDefinition[]
     */
    private static function files(): array
    {
        return [
            new ToolDefinition(
                name: 'files_list',
                description: 'List the contents of a directory on the server. Start at "/" and work down. Mod and plugin configuration usually lives under /config, /plugins or /mods.',
                parameters: self::object([
                    'directory' => self::string('Absolute path from the server root, e.g. "/" or "/config".'),
                ], ['directory']),
                method: 'GET',
                uriTemplate: self::BASE . '/files/list',
                permissions: [Permission::ACTION_FILE_READ],
                queryFields: ['directory'],
                // A directory can hold ten thousand entries; unshaped, one call
                // would consume the entire context window.
                resultShaper: static fn (mixed $data) => self::mapList(
                    $data,
                    static fn (array $a) => array_filter([
                        'name' => $a['name'] ?? null,
                        'is_file' => $a['is_file'] ?? null,
                        'size' => ($a['is_file'] ?? false) ? ($a['size'] ?? null) : null,
                        'modified_at' => $a['modified_at'] ?? null,
                    ], fn ($v) => $v !== null),
                    250
                ),
            ),

            new ToolDefinition(
                name: 'files_read',
                description: 'Read a text file from the server. Always read a config file before editing it — files_write needs its exact current contents.',
                parameters: self::object([
                    'file' => self::string('Absolute path from the server root, e.g. "/config/iceandfire-common.toml".'),
                ], ['file']),
                method: 'GET',
                uriTemplate: self::BASE . '/files/contents',
                permissions: [Permission::ACTION_FILE_READ_CONTENT],
                queryFields: ['file'],
            ),

            new ToolDefinition(
                name: 'files_write',
                description: 'Replace the contents of a text file. You must pass the file\'s exact current contents as original_content — read it with files_read first. The user is shown a diff and approves before anything is written.',
                parameters: self::object([
                    'file' => self::string('Absolute path from the server root.'),
                    'content' => self::string('The complete new contents of the file.'),
                    'original_content' => self::string('The exact current contents, as returned by files_read.'),
                ], ['file', 'content', 'original_content']),
                method: 'POST',
                uriTemplate: self::BASE . '/files/write-with-diff',
                risk: ToolDefinition::RISK_WRITE,
                permissions: [Permission::ACTION_FILE_CREATE, Permission::ACTION_FILE_UPDATE],
                bodyFields: ['file', 'content', 'original_content'],
                // Behind the file.diff named limiter, which stays in force for
                // agent traffic — a runaway write loop should be capped.
                sharesHumanThrottle: true,
                resultShaper: static fn (mixed $data) => [
                    'written' => true,
                    'additions' => $data['attributes']['additions'] ?? null,
                    'deletions' => $data['attributes']['deletions'] ?? null,
                ],
            ),

        ];
    }

    /*
    |--------------------------------------------------------------------------
    | Inspection
    |--------------------------------------------------------------------------
    |
    | Read-only lookups, always offered. Each is one call with a shaped result,
    | and between them they answer most of what is ever asked without the agent
    | having to unlock anything first.
    */

    /**
     * @return ToolDefinition[]
     */
    private static function inspect(): array
    {
        return [
            new ToolDefinition(
                name: 'minecraft_server_info',
                description: 'Detect the Minecraft version, mod loader and platform for this server. Use it before giving version-specific advice.',
                parameters: self::object([]),
                method: 'GET',
                uriTemplate: self::BASE . '/mods/server-config',
                permissions: [Permission::ACTION_FILE_READ],
            ),

            new ToolDefinition(
                name: 'mods_installed',
                description: 'List the mod and plugin jars installed on this server.',
                parameters: self::object([]),
                method: 'GET',
                uriTemplate: self::BASE . '/plugins/installed',
                permissions: [Permission::ACTION_FILE_READ],
                resultShaper: static fn (mixed $data) => self::mapList(
                    is_array($data['data'] ?? null) ? $data : ['data' => $data],
                    static fn (array $a) => [
                        'name' => $a['name'] ?? ($a['file'] ?? null),
                        'enabled' => $a['enabled'] ?? null,
                    ],
                    120
                ),
            ),

            new ToolDefinition(
                name: 'backups_list',
                description: 'List the server\'s backups, newest first.',
                parameters: self::object([]),
                method: 'GET',
                uriTemplate: self::BASE . '/backups',
                permissions: [Permission::ACTION_BACKUP_READ],
                resultShaper: static fn (mixed $data) => self::mapList(
                    $data,
                    static fn (array $a) => [
                        'uuid' => $a['uuid'] ?? null,
                        'name' => $a['name'] ?? null,
                        'bytes' => $a['bytes'] ?? null,
                        'successful' => $a['is_successful'] ?? null,
                        'locked' => $a['is_locked'] ?? null,
                        'created_at' => $a['created_at'] ?? null,
                    ],
                    40
                ),
            ),

            new ToolDefinition(
                name: 'allocations_list',
                description: 'List the server\'s IP addresses and ports.',
                parameters: self::object([]),
                method: 'GET',
                uriTemplate: self::BASE . '/network/allocations',
                permissions: [Permission::ACTION_ALLOCATION_READ],
                resultShaper: static fn (mixed $data) => self::mapList(
                    $data,
                    static fn (array $a) => [
                        'ip' => $a['ip'] ?? null,
                        'port' => $a['port'] ?? null,
                        'primary' => $a['is_default'] ?? null,
                        'notes' => $a['notes'] ?? null,
                    ],
                    25
                ),
            ),

            new ToolDefinition(
                name: 'databases_list',
                description: 'List the server\'s databases and their connection details.',
                parameters: self::object([]),
                method: 'GET',
                uriTemplate: self::BASE . '/databases',
                permissions: [Permission::ACTION_DATABASE_READ],
                resultShaper: static fn (mixed $data) => self::mapList(
                    $data,
                    static fn (array $a) => [
                        'id' => $a['id'] ?? null,
                        'name' => $a['name'] ?? null,
                        'username' => $a['username'] ?? null,
                        'host' => $a['host']['address'] ?? null,
                    ],
                    25
                ),
            ),

            new ToolDefinition(
                name: 'schedules_list',
                description: 'List the server\'s scheduled tasks and when they next run.',
                parameters: self::object([]),
                method: 'GET',
                uriTemplate: self::BASE . '/schedules',
                permissions: [Permission::ACTION_SCHEDULE_READ],
                resultShaper: static fn (mixed $data) => self::mapList(
                    $data,
                    static fn (array $a) => [
                        'id' => $a['id'] ?? null,
                        'name' => $a['name'] ?? null,
                        'active' => $a['is_active'] ?? null,
                        'next_run_at' => $a['next_run_at'] ?? null,
                    ],
                    25
                ),
            ),

            new ToolDefinition(
                name: 'files_download_url',
                description: 'Get a time-limited download link for a file, to give the user when they asked for something extracted or exported.',
                parameters: self::object([
                    'file' => self::string('Absolute path of the file.'),
                ], ['file']),
                method: 'GET',
                uriTemplate: self::BASE . '/files/download',
                permissions: [Permission::ACTION_FILE_READ_CONTENT],
                queryFields: ['file'],
                resultShaper: static fn (mixed $data) => ['url' => $data['attributes']['url'] ?? null],
            ),
        ];
    }

    /*
    |--------------------------------------------------------------------------
    | Groups
    |--------------------------------------------------------------------------
    |
    | Writes the agent pulls in when it needs them. Everything here either
    | destroys something or rearranges the filesystem, and every one of them
    | stops for an approval before it runs — so the activation step costs
    | nothing on a turn that was already going to pause and ask.
    */

    /**
     * @return ToolDefinition[]
     */
    private static function fileEdits(): array
    {
        return [
            new ToolDefinition(
                name: 'files_create_folder',
                description: 'Create a new directory on the server.',
                parameters: self::object([
                    'root' => self::string('The directory to create it in, e.g. "/".'),
                    'name' => self::string('The new directory name.'),
                ], ['root', 'name']),
                method: 'POST',
                uriTemplate: self::BASE . '/files/create-folder',
                risk: ToolDefinition::RISK_WRITE,
                permissions: [Permission::ACTION_FILE_CREATE],
                group: self::GROUP_FILES_EDIT,
                bodyFields: ['root', 'name'],
                resultShaper: static fn () => ['created' => true],
            ),

            new ToolDefinition(
                name: 'files_rename',
                description: 'Rename or move files. Also the safe way to take a backup copy of a config before editing it.',
                parameters: self::object([
                    'root' => self::string('The directory the paths are relative to, e.g. "/".'),
                    'files' => [
                        'type' => 'array',
                        'description' => 'The renames to perform.',
                        'items' => self::object([
                            'from' => self::string('Current name.'),
                            'to' => self::string('New name.'),
                        ], ['from', 'to']),
                    ],
                ], ['root', 'files']),
                method: 'PUT',
                uriTemplate: self::BASE . '/files/rename',
                risk: ToolDefinition::RISK_WRITE,
                permissions: [Permission::ACTION_FILE_UPDATE],
                group: self::GROUP_FILES_EDIT,
                bodyFields: ['root', 'files'],
                resultShaper: static fn () => ['renamed' => true],
            ),

            new ToolDefinition(
                name: 'files_copy',
                description: 'Copy a single file, creating a numbered duplicate alongside it.',
                parameters: self::object([
                    'location' => self::string('Absolute path of the file to copy.'),
                ], ['location']),
                method: 'POST',
                uriTemplate: self::BASE . '/files/copy',
                risk: ToolDefinition::RISK_WRITE,
                permissions: [Permission::ACTION_FILE_CREATE],
                group: self::GROUP_FILES_EDIT,
                bodyFields: ['location'],
                resultShaper: static fn () => ['copied' => true],
            ),

            new ToolDefinition(
                name: 'files_delete',
                description: 'Permanently delete files or directories. This cannot be undone.',
                parameters: self::object([
                    'root' => self::string('The directory the names are relative to.'),
                    'files' => [
                        'type' => 'array',
                        'description' => 'Names to delete, relative to root.',
                        'items' => ['type' => 'string'],
                    ],
                ], ['root', 'files']),
                method: 'POST',
                uriTemplate: self::BASE . '/files/delete',
                risk: ToolDefinition::RISK_DESTRUCTIVE,
                permissions: [Permission::ACTION_FILE_DELETE],
                group: self::GROUP_FILES_EDIT,
                bodyFields: ['root', 'files'],
                resultShaper: static fn () => ['deleted' => true],
            ),

            new ToolDefinition(
                name: 'files_compress',
                description: 'Compress files or folders into an archive. Use this to package a world folder for download.',
                parameters: self::object([
                    'root' => self::string('The directory the names are relative to.'),
                    'files' => [
                        'type' => 'array',
                        'description' => 'Names to include, relative to root.',
                        'items' => ['type' => 'string'],
                    ],
                ], ['root', 'files']),
                method: 'POST',
                uriTemplate: self::BASE . '/files/compress',
                risk: ToolDefinition::RISK_WRITE,
                permissions: [Permission::ACTION_FILE_ARCHIVE],
                group: self::GROUP_FILES_EDIT,
                bodyFields: ['root', 'files'],
                resultShaper: static fn (mixed $data) => [
                    'archive' => $data['attributes']['name'] ?? null,
                    'bytes' => $data['attributes']['size'] ?? null,
                ],
            ),

            new ToolDefinition(
                name: 'files_decompress',
                description: 'Extract an archive in place. Existing files with the same names are overwritten.',
                parameters: self::object([
                    'root' => self::string('The directory to extract into.'),
                    'file' => self::string('The archive name, relative to root.'),
                ], ['root', 'file']),
                method: 'POST',
                uriTemplate: self::BASE . '/files/decompress',
                risk: ToolDefinition::RISK_DESTRUCTIVE,
                permissions: [Permission::ACTION_FILE_CREATE, Permission::ACTION_FILE_UPDATE],
                group: self::GROUP_FILES_EDIT,
                bodyFields: ['root', 'file'],
                resultShaper: static fn () => ['extracted' => true],
            ),
        ];
    }

    /**
     * @return ToolDefinition[]
     */
    private static function backupWrites(): array
    {
        return [
            new ToolDefinition(
                name: 'backup_create',
                description: 'Start a new backup. Backups take minutes; this returns as soon as it has started, and progress is reported separately.',
                parameters: self::object([
                    'name' => self::string('A name for the backup.'),
                ]),
                method: 'POST',
                uriTemplate: self::BASE . '/backups',
                risk: ToolDefinition::RISK_WRITE,
                permissions: [Permission::ACTION_BACKUP_CREATE],
                group: self::GROUP_BACKUPS,
                bodyFields: ['name'],
                resultShaper: static fn (mixed $data) => [
                    'uuid' => $data['attributes']['uuid'] ?? null,
                    'name' => $data['attributes']['name'] ?? null,
                    'started' => true,
                ],
            ),

            new ToolDefinition(
                name: 'backup_restore',
                description: 'Restore a backup over the server\'s current files. The server must be offline. Anything changed since the backup is lost.',
                parameters: self::object([
                    'backup' => self::string('The backup uuid, from backups_list.'),
                    'truncate' => ['type' => 'boolean', 'description' => 'Delete all existing files first.'],
                ], ['backup']),
                method: 'POST',
                uriTemplate: self::BASE . '/backups/{backup}/restore',
                risk: ToolDefinition::RISK_DESTRUCTIVE,
                permissions: [Permission::ACTION_BACKUP_RESTORE],
                group: self::GROUP_BACKUPS,
                bodyFields: ['truncate'],
                resultShaper: static fn () => ['restore_started' => true],
            ),

            new ToolDefinition(
                name: 'backup_delete',
                description: 'Permanently delete a backup.',
                parameters: self::object([
                    'backup' => self::string('The backup uuid, from backups_list.'),
                ], ['backup']),
                method: 'DELETE',
                uriTemplate: self::BASE . '/backups/{backup}',
                risk: ToolDefinition::RISK_DESTRUCTIVE,
                permissions: [Permission::ACTION_BACKUP_DELETE],
                group: self::GROUP_BACKUPS,
                resultShaper: static fn () => ['deleted' => true],
            ),
        ];
    }
}

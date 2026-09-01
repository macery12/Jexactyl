<?php

namespace Everest\Services\AI\Agent;

use Everest\Services\AI\Tools\ToolDefinition;
use Everest\Services\AI\Tools\Definitions\AdminTools;
use Everest\Services\AI\Tools\Definitions\ServerTools;
use Everest\Services\AI\Tools\Definitions\SharedTools;

/**
 * The tools offered for one step, and the phase that shaped them.
 *
 * A phase replaces what cumulative groups tried to be. Groups only ever grew: a
 * turn that looked at billing and then opened a session on a customer's server
 * was still carrying `admin_products_list`, because nothing ever put a group
 * back. A phase states what the conversation is *for* right now, so entering an
 * assist session drops the panel-browsing tools rather than accumulating on top
 * of them — which is both cheaper and more honest, since panel-wide browsing is
 * not part of diagnosing one server.
 *
 * Reserved sets are still permission-filtered by the planner. Being reserved
 * decides what is worth spending budget on; it decides nothing about authority.
 */
class WorkingSet
{
    public const PHASE_SERVER = 'server';
    public const PHASE_ADMIN = 'admin';
    public const PHASE_READ_ASSIST = 'read_assist';
    public const PHASE_WRITE_ASSIST = 'write_assist';

    /**
     * The handful of tools a phase spends budget on before anything else.
     *
     * Small and hard. These outrank the turn's own pins, so every entry has to be
     * something a turn on this surface would be worse off without regardless of
     * what it is doing — `admin_servers_list` earns its place because nearly
     * every admin request opens by resolving a name to a record, and making the
     * model search for that is a step spent on the same lookup every time.
     *
     * Anything merely *likely* to be useful belongs in {@see PREFERRED}, which is
     * spent last and cannot displace a pin.
     */
    public const RESERVED = [
        self::PHASE_SERVER => [
            'server_status',
        ],
        self::PHASE_ADMIN => [
            'admin_servers_list',
            'admin_users_list',
        ],
        self::PHASE_READ_ASSIST => [
            ServerTools::DIAGNOSTIC_SNAPSHOT,
            'files_read',
            AdminTools::ASSIST_ALLOW_WRITES,
        ],
        self::PHASE_WRITE_ASSIST => [
            'server_status',
            'startup_list',
            'files_list',
            'files_read',
            'files_write',
        ],
    ];

    /**
     * What to fill the remaining budget with, best first.
     *
     * Spent after everything else, and only while there is room. Without this the
     * planner leaves slots empty — a server turn with nothing pinned would offer
     * `server_status` and the core host controls, and *every* question would
     * cost a search step before it could cost an answer. That is a worse trade
     * than the old cumulative groups made, and it would have been made on every
     * single turn.
     *
     * An unused slot is worth nothing, so it goes to the tool most likely to be
     * wanted next. Ordered by how often a real question needs it: reads that
     * answer something outright come before writes that need a diagnosis first.
     */
    public const PREFERRED = [
        self::PHASE_SERVER => [
            ServerTools::DIAGNOSTIC_SNAPSHOT,
            'files_list',
            'files_read',
            'activity_recent',
            'startup_list',
            'server_power',
            'backups_list',
            'allocations_list',
            'minecraft_server_info',
            'console_send',
            'mods_installed',
            'files_write',
            'databases_list',
            'schedules_list',
            'files_download_url',
        ],
        self::PHASE_ADMIN => [
            'admin_overview',
            'admin_server_view',
            'admin_user_view',
            'admin_tickets_list',
            AdminTools::TICKET_CONTEXT,
            'admin_activity',
            'admin_ticket_view',
            // Beside the view, because on this surface the two are one action.
            // `admin_ticket_view` returns metadata and nothing else — `tickets`
            // has no body column — so a set holding the view without the
            // messages offers a way to learn that a ticket exists and no way to
            // learn what it says. That is what produced an assistant that listed
            // tickets repeatedly and never picked up the server they were about.
            'admin_ticket_messages',
            AdminTools::ASSIST_SERVER,
            'admin_products_list',
            'admin_orders_list',
        ],
        self::PHASE_READ_ASSIST => [
            ServerTools::DIAGNOSTIC_SNAPSHOT,
            'activity_recent',
            'minecraft_server_info',
            'mods_installed',
            'admin_server_view',
            'admin_ticket_messages',
            'admin_user_view',
            'admin_ticket_view',
            AdminTools::ASSIST_SERVER,
        ],
        self::PHASE_WRITE_ASSIST => [
            'startup_set',
            'server_power',
            'startup_image_set',
            'console_send',
            'activity_recent',
            'admin_ticket_messages',
        ],
    ];

    /**
     * @param ToolDefinition[] $definitions in offer order
     * @param string[] $pinned names held across steps
     * @param string[] $dropped names that left the set on this transition, with a
     *                          reason recorded separately — a removal the model is
     *                          not told about is the failure mode this whole design
     *                          replaced
     * @param string[] $unbudgeted host controls that did not consume a capability slot
     */
    public function __construct(
        public readonly array $definitions,
        public readonly string $phase,
        public readonly array $pinned = [],
        public readonly array $dropped = [],
        public readonly array $unbudgeted = SharedTools::ALWAYS_OFFERED,
    ) {
    }

    /**
     * @return string[]
     */
    public function names(): array
    {
        return array_map(fn (ToolDefinition $d) => $d->name, $this->definitions);
    }

    public function has(string $name): bool
    {
        return in_array($name, $this->names(), true);
    }

    public function size(): int
    {
        return count($this->definitions);
    }

    /**
     * Schemas offered, excluding the host controls selected for this profile.
     *
     * The number an operator's `max_tools` is actually about: discovery and the
     * safety exits are not capability and never compete with it for room.
     */
    public function billableSize(): int
    {
        return count(array_diff($this->names(), $this->unbudgeted));
    }

    /**
     * A rough token cost of the offered schemas, for the discovery log.
     *
     * Bytes of encoded JSON rather than a real tokenizer: the point is to watch a
     * trend and catch a set that has quietly doubled, and no provider agrees on
     * token counts anyway.
     */
    public function schemaBytes(): int
    {
        $bytes = 0;

        foreach ($this->definitions as $definition) {
            $tool = $definition->toAiTool();
            $bytes += strlen($tool->name)
                + strlen($tool->description)
                + strlen((string) json_encode($tool->parameters));
        }

        return $bytes;
    }
}

<?php

namespace Everest\Services\AI\Agent;

use Everest\Models\Permission;

/**
 * An administrator's audited session on a customer's server.
 *
 * The admin assistant works on the panel's own records and cannot see inside a
 * server. That is the right default and stays the default — but it makes the
 * commonest support request in the building ("my server won't start") the one
 * thing the assistant cannot help with, because everything that would answer it
 * is behind a boundary it has no way through.
 *
 * A binding is that way through, and it is deliberately narrow:
 *
 * 1. It is created only by an approved tool call, so an administrator has read
 *    what is about to happen and to whose server, and accepted it by name.
 * 2. It names the abilities it grants, and they start read-only. Widening it is
 *    a second approval, not a flag the model can set.
 * 3. It is the *only* thing `AuthenticateServerAccess` and `ServerPolicy` will
 *    accept from a non-owner administrator, and it is ambient for the duration
 *    of a single dispatched sub-request rather than for the request as a whole
 *    — see {@see AssistSession}.
 * 4. Opening one writes an activity row against the server itself, so it lands
 *    in the customer's own activity feed. Support access a customer cannot see
 *    is not support access, it is surveillance.
 */
class AssistBinding
{
    /**
     * What a fresh binding grants: everything needed to answer "why won't it
     * start", and nothing that could change the answer.
     *
     * `websocket.connect` is what the resources endpoint authorises against, so
     * it is a read here despite the name. It does not confer a console socket;
     * the assistant has no websocket of its own.
     */
    public const READ_ABILITIES = [
        Permission::ACTION_WEBSOCKET_CONNECT,
        Permission::ACTION_ACTIVITY_READ,
        Permission::ACTION_STARTUP_READ,
        Permission::ACTION_FILE_READ,
        Permission::ACTION_FILE_READ_CONTENT,
    ];

    /**
     * What escalation adds.
     *
     * Deletion is absent, and stays absent: an assist session exists to fix a
     * server, and nothing about fixing one requires destroying part of it. The
     * customer's own assistant can delete files, because the customer owns them.
     *
     * `startup.docker-image` is here rather than in with `startup.update`
     * because the panel keeps it apart too, and the distinction is real: the
     * image is the runtime, not a setting the runtime reads. It also happens to
     * be the answer to the commonest form of "it used to start and now it
     * doesn't", so a session without it can reach the diagnosis and stop there.
     */
    public const WRITE_ABILITIES = [
        Permission::ACTION_FILE_CREATE,
        Permission::ACTION_FILE_UPDATE,
        Permission::ACTION_STARTUP_UPDATE,
        Permission::ACTION_STARTUP_DOCKER_IMAGE,
        Permission::ACTION_CONTROL_START,
        Permission::ACTION_CONTROL_STOP,
        Permission::ACTION_CONTROL_RESTART,
        Permission::ACTION_CONTROL_CONSOLE,
    ];

    /**
     * Tools offered while a read-only binding is open.
     *
     * Named explicitly rather than derived from the ability list. The two agree
     * today, and if they ever stop agreeing the ability list is the boundary and
     * this is only what gets advertised — a tool offered without its ability is
     * refused at dispatch, which is the correct way round.
     */
    public const READ_TOOLS = [
        'server_status',
        'activity_recent',
        'startup_list',
        'files_list',
        'files_read',
        'minecraft_server_info',
        'mods_installed',
    ];

    /**
     * Tools escalation adds.
     */
    public const WRITE_TOOLS = [
        'files_write',
        'startup_set',
        'startup_image_set',
        'server_power',
        'console_send',
    ];

    /**
     * The admin tools that stay on offer while a session is open.
     *
     * The rest of the panel-wide base set is dropped for the duration. Not for
     * safety — an administrator's capabilities are unchanged — but for room: the
     * offered set is capped, and a turn spent diagnosing one server has no use
     * for the overview or the activity feed, while it very much has a use for
     * the record of this server and of the person who reported it.
     */
    public const COMPANION_TOOLS = [
        'admin_server_view',
        'admin_user_view',
        'admin_ticket_view',
        'admin_ticket_messages',
    ];

    /**
     * What survives escalation.
     *
     * The server side grows when a session becomes writable, and the offered set
     * is capped, so something has to give. Panel records are the right thing to
     * give: by the time an administrator has approved a change, the ticket, the
     * customer and the server's record have all been read and are sitting in the
     * transcript. What is worth being able to re-read mid-fix is the one thing
     * that cannot be reconstructed from the panel — what the customer actually
     * said.
     */
    public const WRITABLE_COMPANION_TOOLS = [
        'admin_ticket_messages',
    ];

    /**
     * @param string[] $abilities
     */
    public function __construct(
        public readonly string $serverUuid,
        public readonly string $serverName,
        public readonly string $reason,
        public readonly array $abilities = self::READ_ABILITIES,
        public readonly ?int $ticketId = null,
        public readonly bool $writable = false,
    ) {
    }

    /**
     * The same binding with writes added.
     */
    public function escalated(): self
    {
        return new self(
            $this->serverUuid,
            $this->serverName,
            $this->reason,
            array_values(array_unique(array_merge($this->abilities, self::WRITE_ABILITIES))),
            $this->ticketId,
            true,
        );
    }

    public function permits(string $ability): bool
    {
        return in_array($ability, $this->abilities, true);
    }

    /**
     * The tools this binding advertises.
     *
     * @return string[]
     */
    public function tools(): array
    {
        return $this->writable
            ? array_merge(self::READ_TOOLS, self::WRITE_TOOLS)
            : self::READ_TOOLS;
    }

    public function toArray(): array
    {
        return [
            'server_uuid' => $this->serverUuid,
            'server_name' => $this->serverName,
            'reason' => $this->reason,
            'abilities' => $this->abilities,
            'ticket_id' => $this->ticketId,
            'writable' => $this->writable,
        ];
    }

    /** Whether two values grant exactly the same target and authority. */
    public function sameAuthorityAs(self $other): bool
    {
        return $this->toArray() === $other->toArray();
    }

    /**
     * Rebuild from persisted turn state.
     *
     * The stored form must match one of the two canonical ability sets exactly.
     * The blob is the one part of a suspended turn a bug elsewhere could widen,
     * so unknown, missing, or reordered authority is rejected rather than
     * normalized into something usable.
     */
    public static function fromArray(mixed $stored): ?self
    {
        if (!is_array($stored)) {
            return null;
        }

        $uuid = $stored['server_uuid'] ?? null;
        $name = $stored['server_name'] ?? null;
        $reason = $stored['reason'] ?? null;
        $writable = $stored['writable'] ?? null;
        $ticket = $stored['ticket_id'] ?? null;

        if (
            !is_string($uuid) || $uuid === ''
            || !is_string($name)
            || !is_string($reason)
            || !is_bool($writable)
            || ($ticket !== null && !is_int($ticket))
        ) {
            return null;
        }

        $abilities = $stored['abilities'] ?? null;
        $expected = $writable
            ? array_values(array_unique(array_merge(self::READ_ABILITIES, self::WRITE_ABILITIES)))
            : self::READ_ABILITIES;

        if (!is_array($abilities) || array_values($abilities) !== $expected) {
            return null;
        }

        if (array_key_exists('tools', $stored) && $stored['tools'] !== ($writable
            ? array_merge(self::READ_TOOLS, self::WRITE_TOOLS)
            : self::READ_TOOLS)) {
            return null;
        }

        return new self(
            $uuid,
            $name,
            $reason,
            $expected,
            $ticket,
            $writable,
        );
    }
}

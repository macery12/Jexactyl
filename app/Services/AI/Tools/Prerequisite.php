<?php

namespace Everest\Services\AI\Tools;

/**
 * The workflow conditions a tool needs before it can run.
 *
 * These name states the *turn* is in, not permissions the user holds — a
 * prerequisite makes a tool discoverable and tells the model what to do next; it
 * never grants anything. The gateway a prerequisite names still goes through the
 * risk gate, the approval card, and `AssistAuthorizer` exactly as it would if the
 * model had found it on its own.
 *
 * Represented explicitly rather than left for the model to infer, because the
 * cross-scope transitions are the part it gets wrong: an administrator asking to
 * read a customer's startup command needs a resolved server, an approved assist
 * session, and only then the tool they actually wanted, and no amount of prompt
 * text reliably teaches a 7B model that chain.
 */
class Prerequisite
{
    /**
     * The turn is bound to a server. Inherent on the customer surface — a server
     * turn is opened on a route that names one — and unreachable on the admin
     * surface except through an assist session.
     */
    public const SERVER_CONTEXT = 'server_context';

    /**
     * An admin turn has resolved a real server id or uuid, so there is something
     * for an assist request to name.
     */
    public const SELECTED_SERVER = 'selected_server';

    /** An approved read-only {@see \Everest\Services\AI\Agent\AssistBinding} exists. */
    public const READ_ASSIST = 'read_assist';

    /** An approved writable binding exists. Strictly stronger than READ_ASSIST. */
    public const WRITE_ASSIST = 'write_assist';

    /** The assist session was opened against a ticket, so a ticket subject exists. */
    public const TICKET_CONTEXT = 'ticket_context';

    public const ALL = [
        self::SERVER_CONTEXT,
        self::SELECTED_SERVER,
        self::READ_ASSIST,
        self::WRITE_ASSIST,
        self::TICKET_CONTEXT,
    ];

    /**
     * What the model should be told about an unmet prerequisite.
     *
     * Phrased as the action to take rather than the state that is missing:
     * "resolve the server first" is something a model can act on, "selected_server
     * is false" is something it argues with.
     */
    public const REASONS = [
        self::SERVER_CONTEXT => 'This tool acts on one server, and this conversation is not bound to one.',
        self::SELECTED_SERVER => 'Find the server first, so the request names a real one.',
        self::READ_ASSIST => 'Open an approved read-only session on the selected server.',
        self::WRITE_ASSIST => 'Ask for write access on the open session. It is approved separately from reading.',
        self::TICKET_CONTEXT => 'This reads a ticket, so the session has to have been opened against one.',
    ];

    public static function reason(string $prerequisite): string
    {
        return self::REASONS[$prerequisite] ?? 'A prerequisite for this tool has not been met.';
    }
}

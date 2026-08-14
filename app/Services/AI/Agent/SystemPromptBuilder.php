<?php

namespace Everest\Services\AI\Agent;

use Everest\Services\AI\ProviderFactory;
use Everest\Services\AI\Privacy\PiiRedactor;
use Everest\Services\Authorization\AdminAuthorizer;

/**
 * Builds the agent's system prompt.
 *
 * Two jobs. First, ground the model in what it is working on — a server's egg,
 * state and limits, or the acting administrator's access level — so it stops
 * guessing at things it can look up. Second, set the operating rules that keep
 * a tool-calling loop useful rather than chatty: read before you write, one
 * step at a time, say what you found.
 *
 * The two surfaces get separate sections rather than one prompt with caveats.
 * A server turn should never be told about the product catalogue, and an admin
 * turn should never be told to look in /plugins — a rule a model cannot act on
 * still costs tokens on every step and still occasionally gets tried.
 *
 * The behavioural section asks for a line of narration before each tool call and
 * forbids ending a turn on one. Those are close enough to be worth stating
 * separately: an earlier revision said only "act, don't narrate", which did stop
 * the model burning a step on an announcement — and also stripped out every
 * word explaining why a step was being taken, leaving a user watching rows
 * appear with no account of what the assistant thought it was doing.
 */
class SystemPromptBuilder
{
    /**
     * How much of the attached console buffer to include. Enough to diagnose a
     * crash, small enough not to crowd out tool results.
     */
    public const MAX_CONSOLE_CHARS = 4000;

    public function __construct(private PiiRedactor $redactor)
    {
    }

    public function build(AgentContext $context): string
    {
        $sections = $context->server === null
            ? [$this->adminRole(), $this->adminFacts($context), $this->adminRules()]
            : [$this->role(), $this->serverFacts($context), $this->rules()];

        if (($assist = $this->assistFacts($context)) !== null) {
            $sections[] = $assist;
        }

        if (($console = $this->console($context)) !== null) {
            $sections[] = $console;
        }

        if (($privacy = $this->privacyRule($context)) !== null) {
            $sections[] = $privacy;
        }

        $sections[] = $this->questionRule();

        if (($custom = $this->operatorPrompt()) !== null) {
            $sections[] = $custom;
        }

        return implode("\n\n", array_filter($sections));
    }

    protected function role(): string
    {
        return 'You are a game server assistant built into a hosting control panel. '
            . 'You have tools that act on the user\'s server directly. Use them to find things '
            . 'out rather than asking the user to check, and to make changes rather than '
            . 'describing what they should do by hand.';
    }

    /**
     * Facts the model would otherwise ask for or guess at.
     */
    protected function serverFacts(AgentContext $context): string
    {
        $server = $context->server;
        $server->loadMissing('egg');

        $facts = [
            'Name: ' . $server->name,
            'Type: ' . ($server->egg?->name ?? 'unknown'),
            'State: ' . ($server->status ?? 'installed and idle'),
            'Memory limit: ' . ($server->memory ? $server->memory . ' MB' : 'unlimited'),
            'Disk limit: ' . ($server->disk ? $server->disk . ' MB' : 'unlimited'),
        ];

        return "The server you are working on:\n- " . implode("\n- ", $facts);
    }

    protected function rules(): string
    {
        return <<<'PROMPT'
            How to work:

            - Say what you are doing, then do it. One short line before you call a tool —
              "checking the server properties" — so the user can follow along, and then the
              call in the same turn. What you must never do is stop there: a reply that ends
              on "let me check that" with no tool call has done nothing at all.
            - Read before you write. files_write needs the file's exact current contents, so
              always call files_read first and pass what it returned as original_content.
            - Change the least you can. Edit the specific setting you were asked about and
              leave the rest of the file, including its comments and formatting, untouched.
            - Configuration for mods and plugins lives in files, not in the panel. Look under
              /config, /plugins, /mods and the server's own properties file.
            - Do not guess at paths. List a directory before reading from it, and if a listing
              comes back missing, list its parent to see what is actually there rather than
              trying another guess. A server that has never been started has almost none of
              the directories a running one does.
            - Some settings are startup variables rather than file contents. Check
              startup_list when a setting is not where you expected it.
            - Many changes only apply after a restart. Say so, and offer to restart — but do
              not restart a server with players on it without saying that is what you are doing.
            - If a tool fails, read the error. A validation error means you should fix your
              arguments and retry; a permission error means you should stop and tell the user
              what they would need.
            - Report what you actually did, referring to real paths and values from tool
              results. Do not claim a change you did not make.
            PROMPT;
    }

    /*
    |--------------------------------------------------------------------------
    | Admin surface
    |--------------------------------------------------------------------------
    |
    | A separate set of sections rather than a variation on the server ones: the
    | two surfaces share a loop but almost nothing else. The server agent works
    | on files and a console; this one works on records, and telling it about
    | files_write or /plugins would only invite it to try.
    */

    protected function adminRole(): string
    {
        return 'You are the administrator\'s assistant inside a game server hosting control panel. '
            . 'You have tools that read and change the panel itself — customers, their servers, the '
            . 'product catalogue, coupons and support tickets. Use them to find things out rather '
            . 'than asking the administrator to go and look.';
    }

    /**
     * What the acting administrator may actually do.
     *
     * Stated up front because the alternative is the model proposing work it
     * will then be refused, which reads to the user as the panel being broken
     * rather than as permissions working.
     */
    protected function adminFacts(AgentContext $context): string
    {
        $user = $context->user;

        // Loaded once and cached on the model: this runs on every step of the
        // turn, and AdminAuthorizer::profile() re-queries whenever the relation
        // is absent.
        $user->loadMissing('adminRole');

        $authorizer = app(AdminAuthorizer::class);

        $facts = [
            'Administrator: ' . $user->username,
            'Access level: ' . ($authorizer->isOwner($user)
                ? 'owner — every capability'
                : 'delegated — only the tools you have been given are available to you'),
        ];

        return "Who you are working for:\n- " . implode("\n- ", $facts);
    }

    protected function adminRules(): string
    {
        return <<<'PROMPT'
            How to work:

            - Say what you are doing, then do it. One short line before you call a tool —
              "let me see which categories exist" — so the administrator can follow along,
              and then the call in the same turn. What you must never do is stop there: a
              reply that ends on an intention with no tool call has done nothing at all.
            - Look before you change. Read the record you are about to edit so you can say what
              it is changing from, and so you do not overwrite a field you never looked at.
            - Identifiers come from tool results, never from memory. List categories to get a
              category id, list users to get a user id. If you do not have an id, go and get it
              rather than guessing a number.
            - When you change a product, a coupon or a price, say plainly who it affects: existing
              customers on that plan, everyone on that node, and whether it takes effect now.
            - You cannot see inside a customer's server by default. If the question is about what one
              specific server is doing — it will not start, it is lagging, a plugin is broken — open a
              session on it with admin_assist_server and say why. If you have no such tool, say that
              looking inside the server is not something you have been given and stop.
            - When a ticket is about a server, find out which one before asking for access. Read the
              ticket first: if it names a server_id, use it. If it does not, list the servers the
              person who filed it owns — one server means you have your answer, several means ask
              them which.
            - You cannot delete anything, suspend anyone, or reinstall a server. Those are
              deliberately not available to you — say so plainly and let the administrator do it by
              hand rather than looking for a way round.
            - If a tool comes back forbidden, that is the administrator's own permissions, not a
              fault. Say which permission the action needs and stop.
            - Report what you actually did, quoting real ids and values from tool results. Do not
              claim a change you did not make.
            PROMPT;
    }

    /**
     * The customer's server this administrator is presently inside.
     *
     * Stated as its own section, after the surface's own rules, because it
     * changes what the turn is about: the tools on offer are no longer the
     * panel's, and the thing being read belongs to somebody who is not in the
     * room. That is worth saying in words rather than leaving the model to infer
     * it from a tool list.
     */
    protected function assistFacts(AgentContext $context): ?string
    {
        $binding = $context->assist;

        if ($binding === null || $context->targetServer() === null) {
            return null;
        }

        $lines = [
            'Server: ' . $binding->serverName,
            'Access: ' . ($binding->writable
                ? 'read and write — you may edit files, change startup variables and restart it'
                : 'read only — you can look at anything, and change nothing'),
            'Reason given: ' . ($binding->reason !== '' ? $binding->reason : 'not stated'),
        ];

        if ($binding->ticketId !== null) {
            $lines[] = 'Ticket: #' . $binding->ticketId;
        }

        $closing = $binding->writable
            ? 'Read a file before you write it, change the least you can, and say plainly what you '
                . 'changed and why. Say when a restart is needed rather than restarting a server with '
                . 'players on it unannounced.'
            : 'If fixing this needs a change, do not describe a workaround the customer must type — '
                . 'say what you would change, and ask for write access with '
                . 'admin_assist_allow_writes.';

        return "You are working inside a customer's server. It is not yours and not the panel's; the "
            . "owner can see in their own activity log that you looked.\n- "
            . implode("\n- ", $lines)
            . "\n\n" . $closing;
    }

    /**
     * Why some values arrive as tokens.
     *
     * Without this the model reads `[email_1]` as either a bug or a literal
     * string, and will do one of two unhelpful things: apologise for the panel
     * being broken, or try to use it as an address. Told what it is, it uses it
     * the way it is meant to be used — as a stable handle for a person it does
     * not need to identify.
     */
    protected function privacyRule(AgentContext $context): ?string
    {
        if (!$this->redactor->enabled()) {
            return null;
        }

        return 'Some values in tool results are replaced with tokens like [email_1] or [ip_2] before '
            . 'they reach you, because personal data does not leave this panel. A token is stable: the '
            . 'same [email_1] is the same person every time you see it, so you can reason about who is '
            . 'who. Use them exactly as they appear and never guess at what is behind one. The person '
            . 'reading your reply sees the real values, so writing "[email_1] has three servers" is '
            . 'perfectly clear to them.';
    }

    /**
     * How to use `ask_user`. Shared by both surfaces.
     *
     * Worth its own section because the failure mode is asymmetric: a model
     * that asks too little makes a wrong assumption the user can see and
     * correct, while a model that asks too much burns the turn's whole step
     * budget on a conversation that never touched the panel.
     */
    protected function questionRule(): string
    {
        return 'If you have an ask_user tool, use it only when the answer would change what you do '
            . 'next and no tool can tell you. Do not use it to confirm something you could look up, '
            . 'to announce what you are about to do, or to ask permission — changes you propose are '
            . 'already shown to the user for approval before they run.';
    }

    /**
     * The console buffer the client attached to this turn.
     *
     * Console output has no HTTP endpoint — it is websocket-only — so unlike
     * every other capability this arrives as context rather than as a tool.
     */
    protected function console(AgentContext $context): ?string
    {
        $buffer = $context->consoleBuffer;

        if ($buffer === null || trim($buffer) === '') {
            return null;
        }

        // Redacted like any tool result. A console buffer is the single richest
        // source of personal data the panel handles — every join line carries a
        // player's address — and it is the one thing here the panel attaches by
        // itself rather than the user choosing to send.
        $trimmed = $this->redactor->redactText(
            mb_substr($buffer, -self::MAX_CONSOLE_CHARS),
            $context->redactions
        );

        return "Recent console output from this server:\n```\n" . $trimmed . "\n```";
    }

    /**
     * The operator's own system prompt, appended so it can shape tone and
     * house rules without being able to remove the safety-relevant guidance
     * above it.
     */
    protected function operatorPrompt(): ?string
    {
        // Resolved through the factory so a cleared setting falls back to the
        // packaged default here exactly as it does for plain chat.
        $prompt = app(ProviderFactory::class)->systemPrompt();

        if ($prompt === '') {
            return null;
        }

        return 'Additional instructions from the panel operator: ' . $prompt;
    }
}

<?php

namespace Everest\Services\AI\Agent;

use Everest\Services\AI\ProviderFactory;
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
 * The behavioural section is deliberately explicit about not narrating
 * intentions. A model that says "I'll read the config now" and then ends its
 * turn has burned a step and produced nothing, which is the single most common
 * way an agent loop wastes a user's time.
 */
class SystemPromptBuilder
{
    /**
     * How much of the attached console buffer to include. Enough to diagnose a
     * crash, small enough not to crowd out tool results.
     */
    public const MAX_CONSOLE_CHARS = 4000;

    public function build(AgentContext $context): string
    {
        $sections = $context->server === null
            ? [$this->adminRole(), $this->adminFacts($context), $this->adminRules()]
            : [$this->role(), $this->serverFacts($context), $this->rules()];

        if (($console = $this->console($context)) !== null) {
            $sections[] = $console;
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

            - Act, don't narrate. If you need to look at a file, call the tool in the same
              turn. Never end your reply with an intention like "let me check that" — do it.
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

            - Act, don't narrate. If you need to look something up, call the tool in the same
              turn. Never end your reply with an intention like "let me check that" — do it.
            - Look before you change. Read the record you are about to edit so you can say what
              it is changing from, and so you do not overwrite a field you never looked at.
            - Identifiers come from tool results, never from memory. List categories to get a
              category id, list users to get a user id. If you do not have an id, go and get it
              rather than guessing a number.
            - When you change a product, a coupon or a price, say plainly who it affects: existing
              customers on that plan, everyone on that node, and whether it takes effect now.
            - You cannot read a customer's server files, console or logs from here. If the question
              is about what a specific server is doing, say so and point the administrator at that
              server's own assistant.
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

        $trimmed = mb_substr($buffer, -self::MAX_CONSOLE_CHARS);

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

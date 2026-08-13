<?php

namespace Everest\Services\AI\Agent;

use Everest\Models\Setting;

/**
 * Builds the agent's system prompt.
 *
 * Two jobs. First, ground the model in *this* server — egg, state, limits — so
 * it stops guessing at things it can look up. Second, set the operating rules
 * that keep a tool-calling loop useful rather than chatty: read before you
 * write, one step at a time, say what you found.
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
        $sections = [
            $this->role(),
            $this->serverFacts($context),
            $this->rules(),
        ];

        if (($console = $this->console($context)) !== null) {
            $sections[] = $console;
        }

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
        $prompt = Setting::get('settings::modules:ai:system_prompt', config('modules.ai.system_prompt'));

        if (!is_string($prompt) || trim($prompt) === '') {
            return null;
        }

        return 'Additional instructions from the panel operator: ' . trim($prompt);
    }
}

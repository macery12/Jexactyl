<?php

namespace Everest\Services\AI\Tools;

use Everest\Models\Setting;

/**
 * Decides whether a console command the agent wants to send is routine enough
 * to run behind a normal approval click, or needs typed confirmation naming
 * the server.
 *
 * **Fail closed by design.** The rule is an allowlist of commands known to be
 * informational, and anything the classifier does not recognise — including
 * commands nobody thought of — escalates. A denylist would be the friendlier
 * default and the wrong one: a model composing command strings can always
 * reach something that was never on the list, and the cost of guessing wrong
 * is a wiped world or a banned player.
 */
class ConsoleCommandGate
{
    /**
     * Commands that only report state. Deliberately conservative: anything
     * that changes gameplay, permissions, or persistence is absent.
     */
    public const DEFAULT_SAFE = [
        'list', 'players', 'who', 'online',
        'tps', 'mspt', 'lag', 'gc', 'mem', 'memory', 'uptime', 'status', 'ping',
        'plugins', 'pl', 'mods', 'version', 'ver', 'about', 'icanhasbukkit',
        'seed', 'help', '?',
        'whitelist list', 'banlist', 'ban-list',
        'datapack list', 'scoreboard objectives list',
        'forge tps', 'neoforge tps',
    ];

    /**
     * Whether the command may run at the normal write tier.
     */
    public function isSafe(string $command): bool
    {
        $normalised = $this->normalise($command);

        if ($normalised === null) {
            return false;
        }

        $safe = $this->safeCommands();

        // Match the longest declared prefix first so a two-word entry like
        // "whitelist list" cannot be satisfied by the bare "whitelist" verb.
        foreach ([3, 2, 1] as $words) {
            $prefix = $this->prefix($normalised, $words);

            if ($prefix !== null && in_array($prefix, $safe, true)) {
                // A safe verb with trailing arguments is no longer the command
                // that was vetted — "whitelist list" is safe, "whitelist off"
                // is not, and both start with "whitelist".
                return $prefix === $normalised;
            }
        }

        return false;
    }

    /**
     * The effective risk tier for a console command.
     */
    public function risk(string $command): string
    {
        return $this->isSafe($command)
            ? ToolDefinition::RISK_WRITE
            : ToolDefinition::RISK_DESTRUCTIVE;
    }

    /**
     * Lowercase, strip a leading slash, collapse whitespace.
     *
     * Returns null for anything that cannot be treated as a single command —
     * embedded newlines or NUL bytes would let one approved command carry a
     * second, unvetted one to the server.
     */
    protected function normalise(string $command): ?string
    {
        if (preg_match('~[\r\n\x00]~', $command)) {
            return null;
        }

        $trimmed = strtolower(trim($command));
        $trimmed = ltrim($trimmed, '/');
        $trimmed = preg_replace('~\s+~', ' ', $trimmed);

        return $trimmed === '' ? null : trim($trimmed);
    }

    protected function prefix(string $command, int $words): ?string
    {
        $parts = explode(' ', $command);

        if (count($parts) < $words) {
            return null;
        }

        return implode(' ', array_slice($parts, 0, $words));
    }

    /**
     * The allowlist, with any admin additions merged in.
     *
     * Stored as a JSON blob rather than a hydrated config key because it is a
     * list that operators edit per-install.
     */
    public function safeCommands(): array
    {
        $stored = Setting::get('settings::modules:ai:console:safe_commands');

        if (is_string($stored) && $stored !== '') {
            $decoded = json_decode($stored, true);

            if (is_array($decoded)) {
                $extra = array_values(array_filter(array_map(
                    fn ($value) => is_string($value) ? strtolower(trim($value)) : null,
                    $decoded
                )));

                return array_values(array_unique(array_merge(self::DEFAULT_SAFE, $extra)));
            }
        }

        return self::DEFAULT_SAFE;
    }
}

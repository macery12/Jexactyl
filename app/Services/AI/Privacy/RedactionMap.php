<?php

namespace Everest\Services\AI\Privacy;

use Illuminate\Support\Str;

/**
 * The tokens minted for one conversation, and what they stand for.
 *
 * A redactor that replaced every address with the same placeholder would keep
 * the data out of the model and take the meaning with it: two customers would
 * become indistinguishable, and the model would confidently merge them. So each
 * distinct value gets its own stable token — `[email_3f9c1a]` — and the same
 * value seen again in a later tool result resolves to the same one.
 *
 * The map is the panel's, not the model's. It is what lets the assistant reason
 * about "the same user who filed both tickets" while the actual address never
 * leaves the process, and it is what lets the panel put the real value back on
 * screen for the administrator, who is entitled to see it.
 *
 * **Why the tokens are hashes rather than `[email_1]`, `[email_2]`.** Sequential
 * numbering reads better and is wrong. Two maps for the same conversation — a
 * resumed turn and the stored copy, say — both start their count at one, so
 * merging them puts two different people behind one token, and the panel then
 * confidently shows the wrong address next to the right sentence. There is no
 * safe way to resolve that collision after the fact: renumbering rewrites a
 * transcript that has already been read, and dropping the newcomer leaves its
 * token resolving to somebody else. Deriving the token from the value removes
 * the possibility instead of handling it — identical token now means identical
 * value, by construction, so merging is trivially correct.
 *
 * The hash is salted **per map**, which is the privacy-relevant half. An
 * unsalted digest would be a stable pseudonym for that customer across every
 * conversation on the install, and those tokens are the thing that actually
 * reaches the inference provider — so the provider could correlate one person's
 * appearances even though it never learns who they are. A per-conversation salt
 * makes the same address a different token in the next conversation.
 */
class RedactionMap
{
    /**
     * Distinct values one conversation may carry.
     *
     * A single listing mints twenty-five tokens quite legitimately; a file read
     * gone wrong could mint thousands and take the conversation row with it.
     * Past the cap values still get redacted, they just stop being told apart.
     */
    public const MAX_ENTRIES = 250;

    /**
     * Hex characters of digest in a token.
     *
     * Six gives roughly a one-in-five-hundred chance of a collision across a
     * full 250-entry map, which is why `tokenFor()` probes for a longer one
     * rather than trusting it. Longer by default would only make every token
     * harder for a model to copy back verbatim.
     */
    private const TOKEN_CHARS = 6;

    /** @var array<string, string> token => original value */
    private array $values = [];

    /** @var array<string, string> original value => token */
    private array $tokens = [];

    /** @var array<string, string> minted since the last drain */
    private array $fresh = [];

    private string $salt;

    public function __construct(?string $salt = null)
    {
        $this->salt = $salt !== null && $salt !== '' ? $salt : (string) Str::random(24);
    }

    /**
     * The token standing for one value, minting it on first sight.
     */
    public function tokenFor(string $kind, string $value): string
    {
        if (isset($this->tokens[$value])) {
            return $this->tokens[$value];
        }

        // Past the cap, everything of a kind collapses onto one token. Still
        // redacted, no longer correlated — and deliberately not recorded, so a
        // runaway result cannot grow the stored map without bound.
        if (count($this->values) >= self::MAX_ENTRIES) {
            return '[' . $kind . ']';
        }

        $token = $this->mint($kind, $value);

        $this->tokens[$value] = $token;
        $this->values[$token] = $value;
        $this->fresh[$token] = $value;

        return $token;
    }

    /**
     * Derive this value's token, lengthening it until it is unclaimed.
     *
     * A token already in `$values` here belongs to a *different* value — the
     * same one would have short-circuited above — so taking it would put two
     * people behind one name. Probing is deterministic, so the same value in the
     * same map always lands on the same token however many times it is derived.
     */
    private function mint(string $kind, string $value): string
    {
        $digest = hash_hmac('sha256', $value, $this->salt);

        for ($length = self::TOKEN_CHARS; $length < 64; $length += 2) {
            $token = '[' . $kind . '_' . substr($digest, 0, $length) . ']';

            if (!isset($this->values[$token])) {
                return $token;
            }
        }

        return '[' . $kind . '_' . $digest . ']';
    }

    /**
     * Tokens minted since this was last called.
     *
     * Drained rather than re-sent so a long turn does not repeat the whole map
     * on every tool result.
     *
     * @return array<string, string>
     */
    public function drainFresh(): array
    {
        $fresh = $this->fresh;
        $this->fresh = [];

        return $fresh;
    }

    /**
     * @return array<string, string> token => original value
     */
    public function all(): array
    {
        return $this->values;
    }

    public function isEmpty(): bool
    {
        return $this->values === [];
    }

    public function salt(): string
    {
        return $this->salt;
    }

    /**
     * Fold another map in.
     *
     * Safe precisely because tokens are derived: a token present in both maps
     * carries the same value in both, so there is nothing to reconcile. Two maps
     * with *different* salts produce disjoint tokens and simply union — which is
     * the right answer too, since neither transcript ever used the other's.
     */
    public function merge(self $other): void
    {
        foreach ($other->values as $token => $value) {
            if (isset($this->values[$token])) {
                continue;
            }

            $this->values[$token] = $value;
            $this->tokens[$value] ??= $token;
        }
    }

    /**
     * Serialise for storage. The salt travels with the values, or the same
     * address would get a different token every time the map was reloaded.
     */
    public function toArray(): array
    {
        return ['salt' => $this->salt, 'values' => $this->values];
    }

    /**
     * Rebuild from stored state, discarding anything that is not a
     * string => string pair — the column is JSON and has been round-tripped
     * through a database that does not police its shape.
     */
    public static function fromArray(mixed $stored): self
    {
        $stored = is_array($stored) ? $stored : [];

        $salt = is_string($stored['salt'] ?? null) ? $stored['salt'] : null;
        $values = is_array($stored['values'] ?? null) ? $stored['values'] : [];

        $map = new self($salt);

        foreach ($values as $token => $value) {
            if (!is_string($token) || !is_string($value) || $token === '' || $value === '') {
                continue;
            }

            $map->values[$token] = $value;
            $map->tokens[$value] ??= $token;
        }

        return $map;
    }
}

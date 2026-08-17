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

    /**
     * Whether the salt was generated here rather than restored.
     *
     * A conversation's salt has to settle on one value and stay there. Before
     * this, an empty stored map minted a *fresh* salt on every load, so the
     * first turn's tokens were derived under one salt and everything after it
     * under another — one map, two derivations, and a value's token depending
     * on which turn happened to see it first. A provisional salt yields to the
     * first real one it meets in {@see merge()}; a restored one never does.
     */
    private bool $provisionalSalt;

    public function __construct(?string $salt = null)
    {
        $this->provisionalSalt = $salt === null || $salt === '';
        $this->salt = $this->provisionalSalt ? (string) Str::random(24) : $salt;
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
        //
        // The shape is deliberate too: no underscore, so it does not match the
        // pattern the browser restores with. There is nothing behind it to
        // restore, and rendering `[email]` where several different addresses
        // stood is the honest outcome — better than showing one of them and
        // implying the rest were the same person.
        if (count($this->values) >= self::MAX_ENTRIES) {
            return self::overflowToken($kind);
        }

        $token = $this->mint($kind, $value);

        $this->tokens[$value] = $token;
        $this->values[$token] = $value;
        $this->fresh[$token] = $value;

        return $token;
    }

    /** The uncorrelated token a kind collapses onto once the map is full. */
    public static function overflowToken(string $kind): string
    {
        return '[' . $kind . ']';
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
     * Almost always trivial, because both maps normally share a salt: the same
     * value derives the same token on both sides and there is nothing to
     * reconcile. What this cannot do is *assume* that. A token is six hex
     * characters — twenty-four bits — and two independently-salted maps of a
     * couple of hundred entries each collide with probability in the fractions
     * of a percent, which over an install's lifetime is not never. Skipping a
     * token that is already present, as this used to, resolves such a collision
     * by silently discarding the incoming value and leaving its token pointing
     * at somebody else's data. That is the one outcome the whole token scheme
     * exists to prevent.
     *
     * So a collision is detected rather than assumed away, and resolved in the
     * only direction that is safe: the token that is already here keeps its
     * meaning — a stored transcript already refers to it — and the incoming
     * value is reminted into a free token under this map's salt. Deterministic,
     * so the same merge always lands the same way, and the value stays
     * addressable for everything minted afterwards.
     */
    public function merge(self $other): void
    {
        // An empty map with a generated salt has nothing derived under it yet,
        // so adopting the incoming one costs nothing and stops a conversation
        // accumulating tokens from two derivations. The other map's salt is the
        // authoritative one whether it was stored or generated, because it is
        // the salt its tokens were actually minted under.
        if ($this->provisionalSalt && $this->values === []) {
            $this->salt = $other->salt;
            $this->provisionalSalt = $other->provisionalSalt;
        }

        foreach ($other->values as $token => $value) {
            $existing = $this->values[$token] ?? null;

            if ($existing !== null) {
                // Same token, same value: nothing to do. Same token, different
                // value: a real collision, and the incoming one needs a name of
                // its own.
                if ($existing === $value || isset($this->tokens[$value])) {
                    continue;
                }

                $token = $this->mint($this->kindOf($token), $value);
            }

            $this->values[$token] = $value;
            $this->tokens[$value] ??= $token;
        }
    }

    /**
     * The kind a token declares, so a reminted one stays legible as the same
     * sort of thing. Anything unparseable becomes a generic value token rather
     * than being dropped.
     */
    private function kindOf(string $token): string
    {
        return preg_match('/^\[([a-z]+)_[0-9a-f]+]$/', $token, $matches) === 1
            ? $matches[1]
            : 'value';
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

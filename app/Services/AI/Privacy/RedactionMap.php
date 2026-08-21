<?php

namespace Everest\Services\AI\Privacy;

use Illuminate\Support\Str;

/**
 * The tokens minted for one conversation, and what they stand for.
 *
 * Each distinct value gets its own stable token — `[email_3f9c1a]` — so the
 * model can still reason about "the same user who filed both tickets" while the
 * real address never leaves the process. A single shared placeholder would take
 * the meaning with the data and let the model merge two customers.
 *
 * Tokens are hashes rather than `[email_1]` because two maps for one
 * conversation both start counting at one, and merging them would put two
 * people behind one token with no safe way to resolve it afterwards. Deriving
 * from the value makes identical token mean identical value by construction.
 *
 * The hash is salted **per map**: an unsalted digest would be a stable
 * pseudonym letting the inference provider correlate one person across every
 * conversation on the install.
 */
class RedactionMap
{
    /**
     * Distinct values one conversation may carry. A listing legitimately mints
     * twenty-five; a bad file read could mint thousands and take the
     * conversation row with it. Past the cap values are still redacted, just no
     * longer told apart.
     */
    public const MAX_ENTRIES = 250;

    /**
     * Hex characters of digest in a token. Six collides about one time in five
     * hundred across a full map, hence `tokenFor()`'s probe for a longer one;
     * more by default would only make tokens harder to copy back verbatim.
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
     * Whether the salt was generated here rather than restored. A conversation's
     * salt must settle on one value, or a value's token would depend on which
     * turn saw it first. A provisional salt yields to the first real one it
     * meets in {@see merge()}; a restored one never does.
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
     * Derive this value's token, lengthening it until unclaimed. A token already
     * in `$values` belongs to a *different* value — the same one short-circuits
     * above — so taking it would put two people behind one name. Probing is
     * deterministic, so a value always lands on the same token.
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
     * Tokens minted since this was last called. Drained rather than re-sent so a
     * long turn does not repeat the whole map on every tool result.
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
     * Usually trivial, since both maps share a salt and derive the same tokens.
     * But two independently-salted maps of a couple hundred entries collide at
     * 24 bits often enough to matter, and skipping an already-present token
     * would leave it pointing at somebody else's data.
     *
     * So a collision is detected and resolved the only safe way: the existing
     * token keeps its meaning, since a stored transcript already refers to it,
     * and the incoming value is reminted under this map's salt. Deterministic,
     * so the same merge always lands the same way.
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

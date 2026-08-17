<?php

namespace Everest\Services\AI\Privacy;

use Everest\Models\Setting;

/**
 * Strips personal data out of everything on its way to the model.
 *
 * The panel knows a great deal about its customers, and an agent that can read
 * the user table and a ticket thread will put all of it into a request to an
 * inference provider unless something stops it. This filter reduces that
 * exposure with exact structural masking and conservative patterns; it is not
 * de-identification or a general named-entity detector.
 *
 * **What this covers, and what it deliberately does not.** It runs on tool
 * results and on context the panel attaches by itself — a console buffer, a file
 * the model read. It does *not* run on what the administrator types. They chose
 * to type it, and redacting it would break the most ordinary lookup there is:
 * "find the account for someone@example.com" needs that address to reach the
 * filter.
 *
 * Two mechanisms, because either alone is wrong. **Structural** redaction reads
 * the field name — an `email` key is an address whatever it contains — and is
 * exact. **Pattern** redaction sweeps free text, where a customer has pasted
 * their own address into the middle of a sentence, and is necessarily fuzzy. The
 * patterns are written conservatively: a false positive costs the model a fact
 * it needed, which is a worse failure than it sounds, so `payment` is Luhn-
 * checked and `phone` insists on an international prefix rather than matching
 * every run of digits. Names and postal addresses are structural-only: prose
 * can still contain them and must be covered by the operator's provider terms
 * or a separate DLP/NER system.
 */
class PiiRedactor
{
    public const KIND_EMAIL = 'email';
    public const KIND_IP = 'ip';
    public const KIND_NAME = 'name';
    public const KIND_PHONE = 'phone';
    public const KIND_ADDRESS = 'address';
    public const KIND_PAYMENT = 'payment';
    public const KIND_SECRET = 'secret';

    public const KINDS = [
        self::KIND_EMAIL,
        self::KIND_IP,
        self::KIND_NAME,
        self::KIND_PHONE,
        self::KIND_ADDRESS,
        self::KIND_PAYMENT,
        self::KIND_SECRET,
    ];

    /**
     * On unless an operator says otherwise.
     *
     * `secret` is the exception. Token-shaped strings overlap with things the
     * agent legitimately needs — a backup uuid, a file hash, a docker digest —
     * so switching it on trades a little capability for a little safety, and
     * that is the operator's call rather than a default.
     */
    public const DEFAULT_KINDS = [
        self::KIND_EMAIL,
        self::KIND_IP,
        self::KIND_NAME,
        self::KIND_PHONE,
        self::KIND_ADDRESS,
        self::KIND_PAYMENT,
    ];

    /**
     * Field names whose *value* is personal whatever it looks like.
     *
     * Note what is absent from `name`: the bare key `name`. Half the panel uses
     * it for a server, a category, a product or an egg, and matching it would
     * replace the catalogue with tokens and make the agent useless. Only fields
     * that can only be a person's name are listed.
     *
     * @var array<string, string[]>
     */
    private const FIELDS = [
        self::KIND_EMAIL => ['email', 'email_address', 'billing_email', 'contact_email'],
        self::KIND_IP => ['ip', 'ip_address', 'last_login_ip', 'remote_addr', 'client_ip', 'registration_ip'],
        self::KIND_NAME => ['first_name', 'last_name', 'name_first', 'name_last', 'full_name', 'legal_name', 'billing_name'],
        self::KIND_PHONE => ['phone', 'phone_number', 'telephone', 'mobile'],
        self::KIND_ADDRESS => ['address', 'address_1', 'address_2', 'address_line_1', 'address_line_2', 'street', 'city', 'postcode', 'postal_code', 'zip', 'zip_code'],
        self::KIND_PAYMENT => ['card_number', 'iban', 'account_number', 'sort_code', 'last_four'],
        self::KIND_SECRET => ['api_key', 'secret', 'token', 'access_token', 'refresh_token', 'password'],
    ];

    /**
     * Patterns swept over free text.
     *
     * `name` and `address` have none on purpose: there is no expression that
     * recognises a person's name in prose without also eating every proper noun
     * in the paragraph, and a redactor that mangles "the Paper plugin on the
     * London node" has cost more than it saved. Enabling either category means
     * exact field masking only, never that free text has been de-identified.
     *
     * @var array<string, string>
     */
    private const PATTERNS = [
        self::KIND_EMAIL => '/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/',
        // Deliberately loose, because this pattern only *finds* candidates —
        // `parseAddress()` decides what is actually an address. Writing the
        // whole grammar as one expression is what let `::dead:beef` through:
        // the old v6 half required a leading hex group, so a leading-compressed
        // address matched nothing at all and passed through unredacted. A
        // generous candidate plus a real parser has no such tail to miss.
        //
        // The v4 half is fenced by lookarounds rather than \b so a match cannot
        // be a slice of something longer: `1.20.4.1-R0.1` is a jar version, not
        // an address, and `10.0.0.1.2` is neither.
        // The embedded-v4 tail is listed before the hex one because alternation
        // is ordered: with `[A-Fa-f0-9]{0,4}` first, `::ffff:192.168.1.1` ends
        // its candidate at `192` and the redaction leaks the rest of the host.
        self::KIND_IP => '/(?<![\w.\-])(?:\d{1,3}\.){3}\d{1,3}(?![\w.\-])|(?<![\w\-])(?:[A-Fa-f0-9]{0,4}:){1,7}(?:(?:\d{1,3}\.){3}\d{1,3}|[A-Fa-f0-9]{0,4})(?:%[A-Za-z0-9_.\-]{1,32})?/',
        // An international prefix is required. Without it every byte count and
        // millisecond reading in a resources payload matches.
        self::KIND_PHONE => '/\+\d[\d\s().\-]{7,16}\d/',
        self::KIND_PAYMENT => '/\b(?:\d[ \-]?){13,19}\b/',
        self::KIND_SECRET => '/\beyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]+\b|\b(?:sk|pk|api|key|tok|ghp|xox[baprs])[-_][A-Za-z0-9_\-]{16,}\b/i',
    ];

    /**
     * Addresses that describe the panel's own plumbing rather than a person.
     *
     * Compared after `inet_pton()` rather than as strings, so every spelling of
     * the same address — `::1`, `0:0:0:0:0:0:0:1` — is recognised as one entry.
     */
    private const PUBLIC_IPS = ['127.0.0.1', '0.0.0.0', '255.255.255.255', '::1', '::'];

    /**
     * Fields whose values are never swept by pattern.
     *
     * This exists because of one specific and very expensive collision: a
     * four-part version number is a syntactically perfect IPv4 address.
     * `1.20.4.1` is a Minecraft build, and on a game server panel those appear
     * in startup variables, docker tags, jar names and half the console output.
     * Redacting them would leave the assistant unable to give version-specific
     * advice — the single thing it is most often asked for — in exchange for
     * hiding nothing at all.
     *
     * There is no expression that separates the two, so the discrimination is
     * made on the field name instead, where it can actually be made correctly.
     * Structural rules still apply: a field named both `email` and `version`
     * does not exist, and if one did, the structural rule would win.
     *
     * The residual case is honest and worth knowing: a four-part version sitting
     * in a generically-named field — a startup variable called `value`, say —
     * is still read as an address. It costs a token where a version was wanted,
     * which is the safe direction to be wrong in.
     *
     * **The exemption is from the IP pattern and nothing else.** It used to skip
     * `sweep()` outright, which meant a field merely *containing* one of these
     * words — the match is on substrings, so `startup_command` and
     * `minecraft_version` are both covered by one entry — also escaped the
     * email, phone and payment patterns. A startup command is user-editable and
     * routinely holds a webhook URL or an operator's own address, so the one
     * collision this list exists to solve was buying a much larger hole than it
     * was worth.
     */
    private const NEVER_SWEPT = ['version', 'image', 'images', 'command', 'rules', 'hash', 'digest', 'checksum', 'tag'];

    /**
     * Recursively redact a decoded tool result.
     *
     * Keys are left alone and only values are touched: the model needs the shape
     * to reason about the payload, and a tokenised key would break every
     * argument it later builds from one.
     */
    public function redact(mixed $data, RedactionMap $map): mixed
    {
        if (!$this->enabled()) {
            return $data;
        }

        return $this->walk($data, $map, $this->activeKinds());
    }

    /**
     * Redact a block of free text — a console buffer, a file the model read.
     */
    public function redactText(string $text, RedactionMap $map): string
    {
        if (!$this->enabled() || $text === '') {
            return $text;
        }

        return $this->sweep($text, $map, $this->activeKinds());
    }

    /**
     * Put the real values back.
     *
     * No production caller, and that is not an oversight: restoration happens in
     * the browser at render time, which is the better place for it — one map
     * serves prose, tool arguments and payloads alike, and a token that arrives
     * after the text mentioning it still lands.
     *
     * Kept because it is the asserted inverse of `redact()`. The round trip is
     * what proves every minted token is reversible and the map complete, and
     * that property is much easier to state here than across the SSE seam.
     * Never run on what the model reads.
     */
    public function restore(string $text, RedactionMap $map): string
    {
        $values = $map->all();

        return $values === [] ? $text : strtr($text, $values);
    }

    /**
     * @param string[] $kinds
     */
    private function walk(mixed $value, RedactionMap $map, array $kinds, ?string $key = null): mixed
    {
        if (is_array($value)) {
            $out = [];
            foreach ($value as $childKey => $child) {
                $out[$childKey] = $this->walk($child, $map, $kinds, is_string($childKey) ? $childKey : null);
            }

            return $out;
        }

        // A structural hit replaces the whole value regardless of its shape: a
        // numeric `last_four` is still a card fragment.
        if ($key !== null && (is_string($value) || is_int($value) || is_float($value))) {
            $kind = $this->fieldKind($key, $kinds);

            if ($kind !== null) {
                $literal = trim((string) $value);

                return $literal === '' ? $value : $map->tokenFor($kind, $literal);
            }
        }

        if (!is_string($value)) {
            return $value;
        }

        return $this->sweep(
            $value,
            $map,
            $key !== null && $this->neverSwept($key)
                ? array_values(array_diff($kinds, [self::KIND_IP]))
                : $kinds
        );
    }

    /**
     * Which kind of personal data a field name holds, if any.
     *
     * Compared on the name with separators stripped, so `lastLoginIp`,
     * `last_login_ip` and `last-login-ip` are one field rather than three
     * near-misses.
     *
     * @param string[] $kinds
     */
    private function fieldKind(string $key, array $kinds): ?string
    {
        $normalised = strtolower((string) preg_replace('/[^a-z0-9]/i', '', $key));

        foreach ($kinds as $kind) {
            foreach (self::FIELDS[$kind] ?? [] as $field) {
                if ($normalised === str_replace('_', '', $field)) {
                    return $kind;
                }
            }
        }

        return null;
    }

    /**
     * Whether a field's value is exempt from the IP pattern.
     *
     * Matched as a substring so `docker_image`, `startup_command` and
     * `minecraft_version` are all covered without naming each one. That breadth
     * is exactly why the exemption is per-kind: a substring rule wide enough to
     * catch every version-shaped field is far too wide to hand a blanket pass
     * from every other pattern.
     */
    private function neverSwept(string $key): bool
    {
        $normalised = strtolower((string) preg_replace('/[^a-z0-9]/i', '', $key));

        foreach (self::NEVER_SWEPT as $exempt) {
            if (str_contains($normalised, $exempt)) {
                return true;
            }
        }

        return false;
    }

    /**
     * @param string[] $kinds
     */
    private function sweep(string $text, RedactionMap $map, array $kinds): string
    {
        foreach ($kinds as $kind) {
            $pattern = self::PATTERNS[$kind] ?? null;

            if ($pattern === null) {
                continue;
            }

            $replaced = preg_replace_callback(
                $pattern,
                function (array $matches) use ($kind, $map): string {
                    $match = $matches[0];

                    // Addresses are parsed rather than pattern-trusted: the
                    // candidate is deliberately wider than the grammar, so it
                    // is the only kind whose match may be partly prose.
                    if ($kind === self::KIND_IP) {
                        return $this->maskAddress($match, $map);
                    }

                    if (!$this->isRealMatch($kind, $match)) {
                        return $match;
                    }

                    return $map->tokenFor($kind, $match);
                },
                $text
            );

            // preg_replace_callback returns null on backtrack-limit failure,
            // which a large file read can genuinely hit. Keeping the unredacted
            // text would be the wrong way to fail, so the whole string goes.
            if ($replaced === null) {
                return '[redacted: could not be scanned]';
            }

            $text = $replaced;
        }

        return $text;
    }

    /**
     * Second-stage checks for the patterns loose enough to need one.
     */
    private function isRealMatch(string $kind, string $match): bool
    {
        // A run of digits is only a card number if it passes Luhn. This is what
        // keeps timestamps, byte counts and order ids out of the redactor.
        if ($kind === self::KIND_PAYMENT) {
            return $this->passesLuhn((string) preg_replace('/\D/', '', $match));
        }

        return true;
    }

    /**
     * Replace the address inside a candidate, returning whatever prose the
     * candidate over-ran unchanged.
     *
     * The candidate pattern is wider than the address grammar on purpose, so
     * that nothing an address can legally look like is missed. Narrowing back
     * down happens here, where a parser is available and the answer can be
     * exact.
     */
    private function maskAddress(string $candidate, RedactionMap $map): string
    {
        [$address, $tail] = $this->parseAddress($candidate);

        if ($address === null || $this->isPanelAddress($address)) {
            return $candidate;
        }

        return $map->tokenFor(self::KIND_IP, $address) . $tail;
    }

    /**
     * The longest leading run of a candidate that is a real address.
     *
     * Trimming from the right is what makes the loose candidate safe. A log line
     * reading `2001:db8::1: connection refused` produces the candidate
     * `2001:db8::1:` — one character too long — and a grammar strict enough to
     * refuse that is also strict enough to miss the address entirely. Here the
     * trailing colon is simply given back as prose.
     *
     * @return array{0: string|null, 1: string} the address as written, and the text after it
     */
    private function parseAddress(string $candidate): array
    {
        // A leading zero octet is never a routable host, and is how a padded
        // build number ("0.14.2.3") most often shows up.
        if (str_starts_with($candidate, '0.')) {
            return [null, ''];
        }

        for ($value = $candidate; $value !== ''; $value = substr($value, 0, -1)) {
            if (filter_var($this->withoutZone($value), FILTER_VALIDATE_IP) !== false) {
                return [$value, substr($candidate, strlen($value))];
            }
        }

        return [null, ''];
    }

    /**
     * A zone id (`fe80::1%eth0`) is part of the address as written but not part
     * of what `filter_var()` accepts, so it is validated without one and
     * redacted along with the address it qualifies.
     */
    private function withoutZone(string $value): string
    {
        $cut = strpos($value, '%');

        return $cut === false ? $value : substr($value, 0, $cut);
    }

    /**
     * Whether an address describes the panel rather than a person.
     */
    private function isPanelAddress(string $value): bool
    {
        $packed = @inet_pton($this->withoutZone($value));

        if ($packed === false) {
            return false;
        }

        foreach (self::PUBLIC_IPS as $known) {
            $other = @inet_pton($known);

            if ($other !== false && hash_equals($other, $packed)) {
                return true;
            }
        }

        return false;
    }

    private function passesLuhn(string $digits): bool
    {
        $length = strlen($digits);

        if ($length < 13 || $length > 19) {
            return false;
        }

        $sum = 0;
        $double = false;

        for ($i = $length - 1; $i >= 0; --$i) {
            $digit = (int) $digits[$i];

            if ($double) {
                $digit *= 2;
                if ($digit > 9) {
                    $digit -= 9;
                }
            }

            $sum += $digit;
            $double = !$double;
        }

        return $sum % 10 === 0;
    }

    /*
    |--------------------------------------------------------------------------
    | Operator settings
    |--------------------------------------------------------------------------
    */

    public function enabled(): bool
    {
        return (bool) Setting::get(
            'settings::modules:ai:privacy:enabled',
            config('modules.ai.privacy.enabled', true)
        );
    }

    /**
     * The categories in force, stored as a JSON list alongside the tool policy.
     *
     * An unset setting means "the defaults", not "none" — an operator who has
     * never opened the privacy panel should still be protected.
     *
     * @return string[]
     */
    public function activeKinds(): array
    {
        $stored = Setting::get('settings::modules:ai:privacy:categories');

        if (!is_string($stored) || $stored === '') {
            return array_values(array_intersect(
                self::KINDS,
                (array) config('modules.ai.privacy.categories', self::DEFAULT_KINDS)
            ));
        }

        $decoded = json_decode($stored, true);

        if (!is_array($decoded)) {
            return self::DEFAULT_KINDS;
        }

        // Intersected against the canonical list so the order is the declared
        // one and an unknown category cannot reach the walker.
        return array_values(array_intersect(self::KINDS, $decoded));
    }
}

<?php

namespace Everest\Services\AI\Privacy;

use Everest\Models\Setting;

/**
 * Strips personal data out of everything on its way to the model. Exact
 * structural masking plus conservative patterns — not de-identification, and
 * not a general named-entity detector.
 *
 * Runs on tool results and on context the panel attaches itself (a console
 * buffer, a file the model read). Does *not* run on what the administrator
 * types: "find the account for someone@example.com" needs that address to
 * reach the filter.
 *
 * Two mechanisms, since either alone is wrong. **Structural** redaction reads
 * the field name and is exact — an `email` key is an address whatever it
 * holds. **Pattern** redaction sweeps free text and is necessarily fuzzy, so it
 * stays conservative: `payment` is Luhn-checked and `phone` demands an
 * international prefix, because a false positive costs the model a fact it
 * needed. Names and postal addresses are structural-only; prose containing them
 * must be covered by provider terms or a separate DLP/NER system.
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

    /** On unless an operator explicitly narrows the categories. */
    public const DEFAULT_KINDS = [
        self::KIND_EMAIL,
        self::KIND_IP,
        self::KIND_NAME,
        self::KIND_PHONE,
        self::KIND_ADDRESS,
        self::KIND_PAYMENT,
        self::KIND_SECRET,
    ];

    /**
     * Field names whose *value* is personal whatever it looks like. The bare key
     * `name` is deliberately absent — half the panel uses it for a server,
     * category, product or egg, and matching it would tokenise the catalogue.
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
        self::KIND_SECRET => [
            'api_key',
            'secret',
            'client_secret',
            'token',
            'access_token',
            'refresh_token',
            'password',
            'passwd',
            'passphrase',
            'private_key',
            'credentials',
            'authorization',
        ],
    ];

    /**
     * Patterns swept over free text. `name` and `address` have none: no
     * expression finds a person's name in prose without eating every proper noun
     * around it. Enabling either means exact field masking only, never that free
     * text has been de-identified.
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
     * Fields whose values are never swept by the IP pattern.
     *
     * A four-part version number is a syntactically perfect IPv4 address, and
     * `1.20.4.1` appears in startup variables, docker tags, jar names and half
     * the console output of a game server panel. Redacting those would cost
     * version-specific advice while hiding nothing. No expression separates the
     * two, so the discrimination is made on the field name; structural rules
     * still win where they apply.
     *
     * Residual case: a version in a generically-named field is still read as an
     * address, which is the safe direction to be wrong in.
     *
     * **The exemption is from the IP pattern and nothing else.** Matching is on
     * substrings, so exempting `sweep()` outright would also let a startup
     * command — routinely holding a webhook URL or an address — past the email,
     * phone and payment patterns.
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

        $kinds = $this->activeKinds();

        // Startup responses deliberately use a generic `value` field so the
        // model can feed a returned key into startup_set. Field-name redaction
        // cannot tell MYSQL_PASSWORD from SERVER_JARFILE at that point. Seed
        // credential-like entries first so both their value and any resolved
        // occurrence in the startup command receive one reversible token.
        if (in_array(self::KIND_SECRET, $kinds, true)) {
            $this->seedCredentialVariables($data, $map);
        }

        return $this->walk($data, $map, $kinds);
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
     * Put exact known values back. The browser uses this mapping for display;
     * the server uses it only to canonicalize a files_write proposal before the
     * approval and execution boundaries. Never run it on text sent to the model,
     * and never infer or normalize an unknown token-shaped string.
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
            $credentialVariable = in_array(self::KIND_SECRET, $kinds, true)
                && $this->isCredentialVariable($value);
            $out = [];
            foreach ($value as $childKey => $child) {
                if (
                    $credentialVariable
                    && in_array($childKey, ['value', 'server_value', 'default_value'], true)
                    && (is_string($child) || is_int($child) || is_float($child))
                    && (string) $child !== ''
                ) {
                    $out[$childKey] = $map->tokenFor(self::KIND_SECRET, (string) $child);
                    continue;
                }

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

        if ($key !== null && $this->isStartupCommandField($key)) {
            $value = $this->redactKnownSecrets($value, $map);
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
     * Which kind of personal data a field name holds, if any. Separators are
     * stripped, so `lastLoginIp`, `last_login_ip` and `last-login-ip` are one
     * field rather than three near-misses.
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
     * Whether a field's value is exempt from the IP pattern. Matched as a
     * substring, so `docker_image`, `startup_command` and `minecraft_version`
     * are covered without naming each — and that breadth is exactly why the
     * exemption is per-kind rather than a blanket pass.
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
     * Mint tokens for values whose sibling startup-variable key identifies a
     * credential. This is intentionally structural: ordinary variables such as
     * SERVER_JARFILE and VERSION_ID remain useful even when their values happen
     * to look opaque.
     */
    private function seedCredentialVariables(mixed $value, RedactionMap $map): void
    {
        if (!is_array($value)) {
            return;
        }

        if ($this->isCredentialVariable($value)) {
            foreach (['value', 'server_value', 'default_value'] as $field) {
                $literal = $value[$field] ?? null;
                if (is_string($literal) || is_int($literal) || is_float($literal)) {
                    $literal = (string) $literal;
                    if ($literal !== '') {
                        $map->tokenFor(self::KIND_SECRET, $literal);
                    }
                }
            }
        }

        foreach ($value as $child) {
            $this->seedCredentialVariables($child, $map);
        }
    }

    /** @param array<mixed> $value */
    private function isCredentialVariable(array $value): bool
    {
        foreach (['key', 'env_variable'] as $field) {
            if (
                is_string($value[$field] ?? null)
                && trim($value[$field]) !== ''
                && $this->isCredentialIdentifier($value[$field])
            ) {
                return true;
            }
        }

        return false;
    }

    /** A conservative set of credential words used in environment variables. */
    private function isCredentialIdentifier(string $identifier): bool
    {
        $normalised = strtoupper((string) preg_replace('/[^A-Z0-9]+/i', '_', $identifier));
        $normalised = trim($normalised, '_');

        return preg_match(
            '/(?:^|_)(?:PASSWORD|PASS|PASSWD|PWD|PASSPHRASE|SECRET|TOKEN|CREDENTIALS?|AUTHORIZATION|'
                . 'API_KEY|ACCESS_KEY|PRIVATE_KEY|CLIENT_SECRET|DATABASE_URL|REDIS_URL|MONGO_URI|'
                . 'SENTRY_DSN|WEBHOOK_URL)(?:$|_)/',
            $normalised,
        ) === 1;
    }

    private function isStartupCommandField(string $key): bool
    {
        return strtolower((string) preg_replace('/[^a-z0-9]/i', '', $key)) === 'startupcommand';
    }

    /** Replace only values behind secret tokens already minted in this map. */
    private function redactKnownSecrets(string $text, RedactionMap $map): string
    {
        $replacements = [];

        foreach ($map->all() as $token => $literal) {
            if (str_starts_with($token, '[' . self::KIND_SECRET . '_') && $literal !== '') {
                $replacements[$literal] = $token;
            }
        }

        return $replacements === [] ? $text : strtr($text, $replacements);
    }

    /**
     * @param string[] $kinds
     */
    private function sweep(string $text, RedactionMap $map, array $kinds): string
    {
        if (in_array(self::KIND_SECRET, $kinds, true)) {
            $text = $this->redactCredentialAssignments($text, $map);
        }

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
     * Mask credential values in common .env, properties, YAML and simple JSON
     * assignment lines. The key supplies the evidence; the value need not look
     * token-shaped. This keeps ordinary opaque hashes and backup ids available.
     */
    private function redactCredentialAssignments(string $text, RedactionMap $map): string
    {
        $redacted = preg_replace_callback(
            '/^(\s*(?:export\s+)?["\']?([A-Za-z][A-Za-z0-9_.-]*)["\']?\s*[:=]\s*)(\S.*?)(\s*,?\s*)$/m',
            function (array $matches) use ($map): string {
                if (!$this->isCredentialIdentifier($matches[2])) {
                    return $matches[0];
                }

                $literal = $matches[3];
                $quote = '';
                if (
                    strlen($literal) >= 2
                    && in_array($literal[0], ['"', "'"], true)
                    && $literal[-1] === $literal[0]
                ) {
                    $quote = $literal[0];
                    $literal = substr($literal, 1, -1);
                }

                if ($literal === '') {
                    return $matches[0];
                }

                return $matches[1]
                    . $quote
                    . $map->tokenFor(self::KIND_SECRET, $literal)
                    . $quote
                    . $matches[4];
            },
            $text,
        );

        return $redacted ?? '[redacted: could not be scanned]';
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
     * Replace the address inside a candidate, returning any over-run prose
     * unchanged. The candidate pattern is deliberately wider than the address
     * grammar so nothing legal is missed; narrowing happens here, where a parser
     * can be exact.
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
     * The longest leading run of a candidate that is a real address. Trimming
     * from the right is what makes the loose candidate safe: `2001:db8::1:
     * connection refused` yields a candidate one character too long, and a
     * grammar strict enough to refuse it would miss the address entirely.
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
     * An unset setting means the defaults, not "none" — an operator who never
     * opened the privacy panel should still be protected.
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

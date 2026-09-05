<?php

namespace Everest\Services\Queue;

use Illuminate\Support\Str;
use Everest\Services\AI\Privacy\PiiRedactor;
use Everest\Services\AI\Privacy\RedactionMap;

/**
 * Makes a failed job safe to show on the admin page.
 *
 * A failure carries its secrets in two places, and both are handled here. The
 * payload is the obvious one -- a serialised SendEmailJob carries the message
 * body, an invoice job carries billing details. The exception is the less
 * obvious one and, on this framework version, the more dangerous: Laravel
 * interpolates a query's bindings straight into a QueryException message, so a
 * failed write puts its column values into `failed_jobs.exception` verbatim.
 * Masking one and not the other would have left the queue page an incidental
 * data export through the half nobody thinks about.
 *
 * Two passes, deliberately. The AI module's PiiRedactor does the fuzzy work it
 * is already trusted with elsewhere, but it is gated on the AI privacy setting,
 * and an admin page must not become more revealing because someone switched off
 * a setting in a different module. So the structural pass below always runs:
 * key names whose value is a credential or a person are masked whatever the AI
 * module is doing, and the PiiRedactor sweep is applied on top when enabled.
 *
 * This is masking, not de-identification. Anything that must never be seen by
 * an administrator does not belong in a job payload in the first place.
 */
class FailedJobRedactor
{
    /** Values behind these key fragments are never shown, whatever they contain. */
    private const SENSITIVE_KEYS = [
        'password', 'secret', 'token', 'api_key', 'apikey', 'key', 'credential',
        'authorization', 'auth', 'signature', 'private', 'salt', 'hash',
        'card', 'cvv', 'iban', 'account_number', 'routing',
    ];

    /**
     * The same idea for free text, deliberately narrower.
     *
     * In a structure a key is unambiguous, so `key` and `auth` can be matched as
     * fragments. In prose they are not: "foreign key constraint fails" and
     * "auth failed" are the diagnosis, and blanking them would defeat the point
     * of showing the error at all. These fragments only ever match when they are
     * followed by an assignment, so a value is genuinely being named.
     */
    private const SENSITIVE_TEXT_KEYS = [
        'password', 'passwd', 'secret', 'token', 'api[_-]?key', 'apikey',
        'access[_-]?key', 'client[_-]?secret', 'credential', 'authorization',
        'private[_-]?key', 'signature', 'cvv', 'card[_-]?number', 'iban',
        'account[_-]?number',
    ];

    /** Long blobs are truncated: nobody diagnoses a failure from a base64 attachment. */
    private const MAX_STRING = 400;

    /** Depth guard, so a pathological payload cannot walk forever. */
    private const MAX_DEPTH = 8;

    public function __construct(private PiiRedactor $pii)
    {
    }

    /**
     * @param array<string, mixed> $payload
     *
     * @return array<string, mixed>
     */
    public function redact(array $payload): array
    {
        // The serialised command is a PHP-serialised blob, not something an
        // operator reads, and it is where model attributes -- and therefore the
        // bulk of the personal data -- actually live. Report that it exists
        // rather than printing it.
        $payload = $this->summariseCommand($payload);

        $structural = $this->walk($payload, 0);

        try {
            $swept = $this->pii->redact($structural, new RedactionMap());
        } catch (\Throwable) {
            // The redactor is best-effort here; the structural pass has already
            // removed the categorical hazards.
            return is_array($structural) ? $structural : [];
        }

        return is_array($swept) ? $swept : [];
    }

    /**
     * An exception message or stack trace, with named credentials masked.
     *
     * Callers truncate before calling: the point of the bound is to keep an
     * unbounded blob out of a JSON response, and there is no sense running six
     * regexes across a megabyte first.
     */
    public function redactText(string $text): string
    {
        if ($text === '') {
            return $text;
        }

        $text = $this->scrub($text);

        try {
            return $this->pii->redactText($text, new RedactionMap());
        } catch (\Throwable) {
            return $text;
        }
    }

    /**
     * The always-on pass over free text.
     *
     * Every pattern here requires a value to be *named* -- as a query parameter,
     * a header, a JSON field, an array key -- or to be self-identifying, like a
     * bcrypt hash. An ordinary message ("SMTP connection refused", "foreign key
     * constraint fails") comes through untouched, which is the whole point:
     * this page exists to make errors readable.
     */
    private function scrub(string $text): string
    {
        $keys = implode('|', self::SENSITIVE_TEXT_KEYS);

        $patterns = [
            // scheme://user:password@host -- a DSN or a webhook URL echoed back
            // in a connection exception.
            '~(?<=://)([^\s:/@]{1,64}):[^\s@/]{1,256}@~i' => '$1:[redacted]@',

            // Authorization headers, which HTTP client exceptions quote back.
            '~\b(Bearer|Basic|Token)\s+[A-Za-z0-9._\~+/=-]{4,}~i' => '$1 [redacted]',

            // Hashes identify themselves, so they need no key to be recognised.
            '~\$2[aby]?\$\d{2}\$[./A-Za-z0-9]{53}~' => '[redacted]',
            '~\$argon2(?:id|i|d)?\$[^\s"\']{16,}~i' => '[redacted]',

            // "api_key": "…" and 'password' => '…', as JSON bodies and dumped
            // arrays both arrive this way.
            '~([\'"])(\w*(?:' . $keys . ')\w*)\1(\s*(?::|=>)\s*)([\'"])[^\'"]*\4~i' => '$1$2$1$3$4[redacted]$4',

            // api_key=…, password: …, token => … -- the unquoted forms, and the
            // query-string case that a request URL brings with it. An auth
            // scheme word is skipped: the rule above has already taken the
            // token behind it, and masking `Bearer` too only costs legibility.
            '~\b(\w*(?:' . $keys . ')\w*)(\s*(?:=>|[:=])\s*)(?![\'"]|\[redacted\]|(?:Bearer|Basic|Token)\b)([^\s,;&)\]}]{1,512})~i' => '$1$2[redacted]',
        ];

        foreach ($patterns as $pattern => $replacement) {
            $replaced = preg_replace($pattern, $replacement, $text);

            // preg_replace returns null on backtrack-limit exhaustion. Keeping
            // the text as it was would be the wrong way to fail here, but so
            // would dropping the diagnosis: report the pass that gave up.
            $text = is_string($replaced) ? $replaced : $text . "\n[redaction incomplete: pattern limit reached]";
        }

        return $text;
    }

    /**
     * @param array<string, mixed> $payload
     *
     * @return array<string, mixed>
     */
    private function summariseCommand(array $payload): array
    {
        if (isset($payload['data']['command']) && is_string($payload['data']['command'])) {
            $payload['data']['command'] = sprintf(
                '[serialised %s, %s bytes — not shown]',
                $payload['data']['commandName'] ?? 'command',
                number_format(strlen($payload['data']['command'])),
            );
        }

        return $payload;
    }

    private function walk(mixed $value, int $depth): mixed
    {
        if ($depth > self::MAX_DEPTH) {
            return '[…]';
        }

        if (is_array($value)) {
            $out = [];

            foreach ($value as $key => $item) {
                $out[$key] = is_string($key) && $this->isSensitive($key)
                    ? '[redacted]'
                    : $this->walk($item, $depth + 1);
            }

            return $out;
        }

        if (is_string($value)) {
            return Str::limit($value, self::MAX_STRING, '… [truncated]');
        }

        return $value;
    }

    private function isSensitive(string $key): bool
    {
        $key = Str::lower($key);

        foreach (self::SENSITIVE_KEYS as $fragment) {
            if (str_contains($key, $fragment)) {
                return true;
            }
        }

        return false;
    }
}

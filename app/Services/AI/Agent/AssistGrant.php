<?php

namespace Everest\Services\AI\Agent;

/**
 * An authenticated assist grant attached to one suspended action.
 *
 * The resumable agent state is model-derived JSON. It is useful replay state,
 * but it is not an authorization record. This object signs the exact binding
 * that existed before approval and the exact binding approval may create,
 * together with the pending action's identity and arguments. A modified state
 * blob can therefore make the turn fail, but cannot widen or retarget access.
 */
final class AssistGrant
{
    public const PHASE_NONE = 'none';
    public const PHASE_OPEN = 'open';
    public const PHASE_ESCALATE = 'escalate';
    public const PHASE_ACTIVE = 'active';

    private function __construct(
        public readonly string $phase,
        public readonly ?AssistBinding $before,
        public readonly ?AssistBinding $after,
    ) {
    }

    /**
     * @return array{grant: array<string, mixed>, mac: string}
     */
    public static function seal(
        string $phase,
        ?AssistBinding $before,
        ?AssistBinding $after,
        string $turnId,
        int $userId,
        string $toolName,
        array $arguments,
    ): array {
        $grant = [
            'phase' => $phase,
            'before' => $before?->toArray(),
            'after' => $after?->toArray(),
        ];

        return [
            'grant' => $grant,
            'mac' => hash_hmac('sha256', self::message($grant, $turnId, $userId, $toolName, $arguments), self::key()),
        ];
    }

    public static function verify(
        mixed $stored,
        mixed $mac,
        string $turnId,
        int $userId,
        string $toolName,
        array $arguments,
    ): ?self {
        if (!is_array($stored) || !is_string($mac) || !preg_match('/^[a-f0-9]{64}$/', $mac)) {
            return null;
        }

        $expected = hash_hmac(
            'sha256',
            self::message($stored, $turnId, $userId, $toolName, $arguments),
            self::key(),
        );

        if (!hash_equals($expected, $mac)) {
            return null;
        }

        $phase = $stored['phase'] ?? null;
        $beforeRaw = $stored['before'] ?? null;
        $afterRaw = $stored['after'] ?? null;
        $after = $afterRaw === null ? null : AssistBinding::fromArray($afterRaw);
        $before = $beforeRaw === null ? null : AssistBinding::fromArray($beforeRaw);

        if (
            !in_array($phase, [self::PHASE_NONE, self::PHASE_OPEN, self::PHASE_ESCALATE, self::PHASE_ACTIVE], true)
            || ($afterRaw !== null && $after === null)
            || ($beforeRaw !== null && $before === null)
        ) {
            return null;
        }

        if (
            ($phase === self::PHASE_NONE && ($before !== null || $after !== null))
            || ($phase === self::PHASE_OPEN && ($before !== null || $after === null || $after->writable))
            || ($phase === self::PHASE_ESCALATE && ($before === null || $after === null || $before->writable || !$after->writable))
            || ($phase === self::PHASE_ACTIVE && ($before === null || $after === null || !$before->sameAuthorityAs($after)))
            || ($before !== null && $after !== null && $before->serverUuid !== $after->serverUuid)
        ) {
            return null;
        }

        return new self($phase, $before, $after);
    }

    /** The raw state must describe exactly the authority that existed before approval. */
    public function matchesState(mixed $stateAssist): bool
    {
        if ($this->before === null) {
            return $stateAssist === null;
        }

        $stored = AssistBinding::fromArray($stateAssist);

        return $stored !== null && $stored->sameAuthorityAs($this->before);
    }

    /**
     * @param array<string, mixed> $grant
     */
    private static function message(
        array $grant,
        string $turnId,
        int $userId,
        string $toolName,
        array $arguments,
    ): string {
        $payload = [
            'turn_id' => $turnId,
            'user_id' => $userId,
            'tool_name' => $toolName,
            'arguments' => $arguments,
            'grant' => $grant,
        ];

        $json = json_encode(self::canonicalise($payload), JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if ($json === false) {
            throw new \RuntimeException('The assist grant could not be encoded.');
        }

        return $json;
    }

    private static function key(): string
    {
        $key = (string) config('app.key');
        if (str_starts_with($key, 'base64:')) {
            $decoded = base64_decode(substr($key, 7), true);
            $key = $decoded === false ? '' : $decoded;
        }

        if ($key === '') {
            throw new \RuntimeException('An application key is required to authenticate assist grants.');
        }

        return $key;
    }

    private static function canonicalise(mixed $value): mixed
    {
        if (!is_array($value)) {
            return $value;
        }

        if (!array_is_list($value)) {
            ksort($value, SORT_STRING);
        }

        foreach ($value as $key => $item) {
            $value[$key] = self::canonicalise($item);
        }

        return $value;
    }
}

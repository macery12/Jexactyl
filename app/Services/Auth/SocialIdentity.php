<?php

namespace Everest\Services\Auth;

/**
 * A normalised identity returned by an OAuth provider.
 *
 * Discord is called over raw HTTP and Google through Socialite, so each returns
 * a differently shaped object. Flattening both into this DTO keeps the account
 * resolution logic provider-agnostic.
 */
readonly class SocialIdentity
{
    public function __construct(
        public string $provider,
        public string $id,
        public ?string $email,
        public ?string $username = null,
        public ?string $avatar = null,
    ) {
    }

    /**
     * Session-safe representation. Only ever holds public profile data — no
     * access or refresh tokens are persisted anywhere.
     */
    public function toArray(): array
    {
        return [
            'provider' => $this->provider,
            'id' => $this->id,
            'email' => $this->email,
            'username' => $this->username,
            'avatar' => $this->avatar,
        ];
    }

    public static function fromArray(array $data): self
    {
        return new self(
            provider: (string) ($data['provider'] ?? ''),
            id: (string) ($data['id'] ?? ''),
            email: $data['email'] ?? null,
            username: $data['username'] ?? null,
            avatar: $data['avatar'] ?? null,
        );
    }
}

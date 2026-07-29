# Application API Keys — Access Profiles

**Status:** Implemented · **Updated:** 2026-07-29

> **Deployment action:** place the panel in maintenance mode and run the
> migrations before using Application API keys.
>
> ```bash
> php artisan down
> php artisan migrate --force
> php artisan up
> ```

Application API keys (`ptla_…`, `ApiKey::TYPE_APPLICATION`) are non-interactive
panel service identities. Every key is bound to exactly one API-eligible Access
Profile, and that profile's canonical capabilities are the key's complete
runtime authority.

```text
key authority = capabilities in the key's Access Profile
```

The user who creates a key is retained as its creator for authentication
plumbing, revocation, and audit attribution. The key does not inherit that
user's Access Profile and does not become more or less powerful when the
creator's human permissions change.

## Security model

- A key must reference one Access Profile with `api_eligible = true`.
- Custom profiles are not API eligible by default; an Owner must explicitly
  enable them for service credentials.
- The built-in Owner profile can never be assigned to a key.
- A caller may assign only a profile whose capabilities are a subset of the
  caller's own effective capabilities.
- A key with `api.create` may create another key only with an equal or narrower
  profile.
- Owner-only human operations are never available to a service key. In
  particular, a key cannot perform a Wings/system daemon upgrade merely because
  its creator is an Owner.
- Unknown capability IDs fail closed.
- Application API actions without an explicit capability declaration fail
  closed.
- Key expiry is enforced by Sanctum before the Application API middleware runs.
- Optional IPv4, IPv6, and CIDR restrictions are enforced by the shared API IP
  middleware.
- The creator account must continue to exist and remain active. This is a
  deliberate emergency-revocation boundary, not an authority source.

The same canonical capability IDs are used by human Access Profiles and service
profiles, for example:

```text
servers.read
servers.update
allocations.read
allocations.create
server-databases.read
server-databases.delete
billing.orders
```

Allocations, locations, and server databases have their own capabilities.
Granting allocation access does not grant general node editing, and granting
server-database access does not grant general server editing.

## Selecting a profile

The key form obtains selectable profiles from:

```http
GET /api/application/api/access-profiles
```

This endpoint requires `api.create`. It returns only profiles that:

1. are API eligible;
2. are not Owner; and
3. do not exceed the requesting human or service identity's authority.

This avoids exposing or offering profiles the caller cannot safely delegate.

## Creating a key

```http
POST /api/application/api
```

Example:

```json
{
  "memo": "Provisioning integration",
  "access_profile_id": 12,
  "allowed_ips": [
    "203.0.113.10",
    "2001:db8::/48"
  ],
  "expires_at": "2027-01-01T00:00:00Z"
}
```

Fields:

| Field | Required | Meaning |
|---|---:|---|
| `memo` | Yes | Human-readable purpose of the credential. |
| `access_profile_id` | Yes | API-eligible, non-Owner Access Profile within the caller's delegation ceiling. |
| `allowed_ips` | No | Up to 50 valid IP addresses or CIDR ranges. Empty means any IP. |
| `expires_at` | No | Future date/time after which authentication stops. |

`admin_role_id` is accepted as a temporary alias for
`access_profile_id`. If both are supplied, they must match.

The canonical profile contract and the historical `permissions` contract are
mutually exclusive. A request containing both is rejected so clients cannot
mistakenly assume two authorization layers are active.

The secret token is returned only in the create response. It cannot be retrieved
again; replace the key if the secret is lost.

## Listing keys

```http
GET /api/application/api
```

Each key includes its bound profile, creator, IP restrictions, expiry, creation
time, and last-use time:

```json
{
  "id": 42,
  "identifier": "ptla_…",
  "description": "Provisioning integration",
  "allowed_ips": ["203.0.113.10"],
  "expires_at": "2027-01-01T00:00:00+00:00",
  "access_profile_id": 12,
  "access_profile": {
    "id": 12,
    "name": "Provisioning",
    "api_eligible": true,
    "is_owner": false,
    "permissions": ["servers.read", "servers.create"]
  },
  "creator": {
    "id": 3,
    "username": "operator",
    "email": "operator@example.test"
  }
}
```

The historical `permissions` resource map may remain in responses during the
transition for old clients. Once `access_profile_id` is present, those stored
`r_*` values are dormant and are not evaluated.

Profiles are live policy objects. Editing an API-eligible profile changes the
authority of every key assigned to it. Use separate profiles when integrations
need independent policy or lifecycle.

## Revoking or changing access

Key scopes are changed through their Access Profile:

- edit the profile to change all identities using it;
- assign integrations separate profiles for independent control; or
- create a replacement key and delete the old key for credential rotation.

Delete a key with:

```http
DELETE /api/application/api/{id}
```

The endpoint rejects client/account keys even when their numeric ID is supplied.

## Historical key migration

Migration
`2026_07_29_000004_bind_application_keys_to_access_profiles.php` converts every
existing Application API key to a profile-backed identity.

Each existing key receives an ordinary, editable, API-eligible profile named
from its key identifier. It is not an Owner or protected system profile.

The conversion never broadens authority:

- the creator's effective human capabilities form the upper bound;
- an enforced legacy `r_*` mask further limits its mapped capabilities;
- legacy modules that were previously role-only retain only the creator's
  existing capabilities;
- nested allocation, location, and server-database masks map to their new
  granular capabilities rather than to broader node/server capabilities;
- unknown stored permission IDs are discarded;
- a key whose creator has no valid Access Profile receives an empty profile and
  fails closed.

Historical all-zero keys that previously behaved as role-only keys are converted
from the creator's authority at migration time. They are no longer silently
unrestricted and no longer track later creator-profile changes.

The old `r_*` columns and `acl_enforced` marker remain as dormant rollback and
forensics data. Runtime authorization does not consult them after a profile is
bound.

Pterodactyl-family imports run the same conversion after copying keys, so
imported Application API keys cannot enter the system without a profile.

## Compatibility create contract

Older automation may temporarily create a key with a complete historical
`permissions` map and no `access_profile_id`. The backend translates that map
into a new, editable API-eligible profile:

```json
{
  "memo": "Legacy integration",
  "permissions": {
    "servers": "read",
    "nodes": "none",
    "allocations": "write",
    "users": "none",
    "locations": "none",
    "nests": "none",
    "eggs": "read",
    "database_hosts": "none",
    "server_databases": "none"
  }
}
```

The generated capability set is intersected with the caller's authority. It
contains only capabilities representable by the historical map; it does not
silently add access to newer modules. Historical complete `r_*` numeric payloads
are also normalized (`2` and `3` both mean read and write).

New clients should always select an Access Profile instead.

## Authorization flow

For each Application API request:

1. Sanctum authenticates the token and rejects an expired key.
2. Shared API middleware checks any configured IP restrictions.
3. `AuthenticateApplicationUser` requires an active creator and a valid
   API-eligible, non-Owner key profile.
4. `ApplicationApiPermissionResolver` resolves the action's explicit canonical
   capability.
5. `AuthorizeApplicationUser` checks that capability against the key profile.
6. Transformer includes independently require the corresponding canonical read
   capability before related data is expanded.

Browser sessions continue to use the signed-in human's Access Profile.
Application keys bypass human 2FA state because they are non-interactive
credentials, but remain subject to profile, expiry, IP, active-creator, and audit
controls.

## Main implementation files

- `app/Services/Authorization/ApplicationApiAccessProfileService.php`
- `app/Services/Authorization/AdminCapabilityRegistry.php`
- `app/Http/Middleware/Api/Application/AuthenticateApplicationUser.php`
- `app/Http/Middleware/Api/Application/AuthorizeApplicationUser.php`
- `app/Http/Requests/Api/Application/Api/StoreApplicationApiKeyRequest.php`
- `app/Http/Controllers/Api/Application/Api/ApiController.php`
- `app/Services/Api/KeyCreationService.php`
- `app/Services/Api/LegacyApplicationKeyProfileMigrationService.php`
- `app/Transformers/Api/Application/ApiKeyTransformer.php`
- `database/migrations/2026_07_29_000004_bind_application_keys_to_access_profiles.php`

## Focused verification

```bash
vendor/bin/phpunit \
  tests/Unit/Services/Authorization/ApplicationApiAccessProfileServiceTest.php \
  tests/Unit/Http/Middleware/Api/Application/AuthorizeApplicationUserTest.php
```

Integration tests require the project's test database configuration:

```bash
vendor/bin/phpunit \
  tests/Integration/Api/Application/Api/ApiKeyControllerTest.php
```

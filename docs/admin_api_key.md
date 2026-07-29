# Admin (Application) API Keys — Per-Resource Read/Write Scoping

**Status:** Implemented · **Updated:** 2026-07-29

Application API keys (`ptla_…`, `ApiKey::TYPE_APPLICATION`) have a second
authorization layer in addition to the owning administrator's live role:

```text
effective access = owner role allows the action
                AND key scope allows the resource/action
```

A key cannot gain privileges its owner does not currently hold. A root
administrator's role check remains unrestricted, but a root-owned API key is
still constrained by that key's scope.

## Scope vocabulary

The restored ACL intentionally keeps the nine historical Pterodactyl resource
columns. It does not add scopes for this panel's newer modules.

| API resource | Stored column | Live endpoint mapping |
|---|---|---|
| Servers | `r_servers` | `servers.*`, except server presets and nested server databases |
| Nodes | `r_nodes` | `nodes.*`, except nested allocations |
| Allocations | `r_allocations` | `/nodes/{node}/allocations/**` |
| Users | `r_users` | `users.*` |
| Locations | `r_locations` | Compatibility-only; this panel currently has no location endpoint or include |
| Nests | `r_nests` | `nests.*` |
| Eggs | `r_eggs` | `eggs.*`, including egg import under a nest |
| Database hosts | `r_database_hosts` | `/databases/**` |
| Server databases | `r_server_databases` | `/servers/{server}/databases/**` |

`GET` and `HEAD` require read access. Every other HTTP method requires write
access. This matters for operations such as egg export: its role permission is
`eggs.export`, but its `GET` route is correctly treated as a read.

Modules outside this table (billing, tickets, settings, AI, email, API-key
management, and others) remain role-only. This is a faithful restoration of the
legacy nine-resource ACL, not full scope coverage for the expanded application
API.

## Stored values and public API values

The database uses a bit mask:

```text
NONE = 0
READ = 1
WRITE = 2
READ + WRITE = 3
```

The supported product-level grants are `none`, `read`, and `write`, where
`write` means read and write and is stored as `3`. New APIs do not expose raw
bit arithmetic.

### Create request

`POST /api/application/api` accepts a complete resource map:

```json
{
  "memo": "Provisioning integration",
  "permissions": {
    "servers": "read",
    "nodes": "write",
    "allocations": "none",
    "users": "none",
    "locations": "none",
    "nests": "read",
    "eggs": "read",
    "database_hosts": "none",
    "server_databases": "none"
  }
}
```

All nine keys are required and unknown keys or grant names are rejected.

For backward compatibility, the historical complete payload using `r_*` names
and numeric strings is also accepted:

```json
{
  "permissions": {
    "r_servers": "0",
    "r_nodes": "2",
    "r_allocations": "0",
    "r_users": "0",
    "r_locations": "0",
    "r_nests": "0",
    "r_eggs": "0",
    "r_database_hosts": "0",
    "r_server_databases": "0"
  }
}
```

The former UI described historical value `2` as “Read & Write,” even though the
bitwise ACL requires `3` for that result. The compatibility parser therefore
normalizes legacy `2` (and `3`) to canonical `write`/stored `3`.

### List response

`ApiKeyTransformer` returns:

```json
{
  "legacy": false,
  "permissions": {
    "servers": "read",
    "nodes": "write",
    "allocations": "none"
  }
}
```

The real response contains all nine resources. `legacy: true` means the key is
intentionally using the compatibility behavior described below; its stored
zeroes must not be interpreted or displayed as “no access.”

Scopes are immutable. Re-scope a key by creating a replacement and revoking the
old key.

## Enforcement

### Endpoint requests

`AuthorizeApplicationUser` is the route-wide authorization gate. It:

1. Resolves the action's required `AdminRole` permission with
   `ApplicationApiPermissionResolver`.
2. Enforces that role permission (root administrators bypass only this step).
3. Resolves the legacy key resource, including route-aware overrides for
   allocations and server databases.
4. Calls `AdminAcl::keyPermits()` for the required read/write action.

Central middleware enforcement is required because not every action relies on
the base `ApplicationApiRequest::authorize()` implementation.

### Included relationships

`Transformer::authorize()` independently intersects the owner's read permission
with the key's read grant before expanding a related resource. A denied include
is omitted/null according to the transformer's existing include behavior; it
does not turn the entire endpoint response into a 403.

### Sessions and unexpected tokens

Admin UI requests carry Laravel Sanctum's `TransientToken` and bypass the key
gate; their existing role checks still apply. A missing or unexpected token type
fails closed whenever a mapped key resource is being checked.

### Delegating new keys

The API-key management module is outside the legacy resource vocabulary. To
prevent a narrow key from escaping its scope through `api.create`, a scoped
application key may create only a key whose nine grants are a subset of its own.
Session requests and unrestricted legacy keys are not limited by this delegation
check. The new key is still intersected with the owner's role.

The delete endpoint also verifies that its route-bound target is an application
key, so it cannot delete a client key by ID.

## Legacy and migration behavior

A fixed `created_at` cutoff is not safe:

- Older native keys may already contain intentional scopes.
- Imported Pterodactyl keys retain their original timestamps.
- A source/deployment timestamp creates a race during rollout.
- `created_at` is nullable.

Migration `2026_07_29_000001_mark_scoped_api_keys.php` adds the deterministic
`acl_enforced` marker instead.

For keys already in this panel when the migration runs:

- Application keys with any nonzero `r_*` grant are marked enforced, restoring
  their stored restrictions.
- Historical stored value `2` is normalized to `3`.
- All-zero application keys remain `acl_enforced = false` and retain their
  previous role-only behavior. These are shown as legacy unrestricted keys and
  should be rotated when practical.

For keys created after the migration:

- `KeyCreationService` always writes all nine grants.
- `acl_enforced` is always true.
- An all-`none` key is a genuine no-resource-access key, not a legacy key.

For `p:migrate:import`:

- Every imported Pterodactyl-family application key is marked enforced,
  including an all-zero/no-access key.
- Historical value `2` is normalized to `3`.
- Account/client keys are not subject to the application ACL.

This marker adds schema metadata but does not add or widen the resource
vocabulary.

## User interface

The create modal presents nine accessible `None / Read / Read & write` radio
groups and defaults each resource to `None`. The key list displays each scoped
grant, distinguishes a scoped all-none key from a legacy unrestricted key, and
never exposes the secret token after its one-time creation response.

English, Danish, and Russian catalogs contain the resource/grant/legacy labels.
The UI also states that:

- the owner's current role is always intersected with the key;
- the nine controls cover only the legacy resource vocabulary;
- other application API modules remain role-only.

## Main implementation files

- `app/Services/Acl/Api/AdminAcl.php`
- `app/Services/Authorization/ApplicationApiPermissionResolver.php`
- `app/Http/Middleware/Api/Application/AuthorizeApplicationUser.php`
- `app/Transformers/Api/Transformer.php`
- `app/Http/Requests/Api/Application/Api/StoreApplicationApiKeyRequest.php`
- `app/Http/Controllers/Api/Application/Api/ApiController.php`
- `app/Services/Api/KeyCreationService.php`
- `app/Transformers/Api/Application/ApiKeyTransformer.php`
- `database/migrations/2026_07_29_000001_mark_scoped_api_keys.php`
- `app/Services/Migration/Profiles/PterodactylProfile.php`
- `frontend/src/api/adminApiKeys.ts`
- `frontend/src/pages/admin/api/ApiKeyFormModal.tsx`
- `frontend/src/pages/admin/api/ApiKeysListPage.tsx`

`KeyCreationService` calls repository creation with `forceFill`, so the `r_*`
columns do not need to be added to `ApiKey::$fillable`.

## Verification

Focused backend tests cover:

- bit-mask enforcement and legacy/session behavior;
- route-aware allocation and server-database mapping;
- GET/read versus non-GET/write mapping;
- root-owned narrow keys;
- subset-only key delegation;
- canonical and historical create payloads;
- persistence and list serialization.

Run them with:

```bash
vendor/bin/phpunit \
  tests/Unit/Services/Acl/Api/AdminAclTest.php \
  tests/Unit/Services/Authorization/ApplicationApiPermissionResolverTest.php \
  tests/Unit/Http/Middleware/Api/Application/AuthorizeApplicationUserTest.php
```

Integration tests require a file-backed SQLite database whose filename contains
`test`, with migrations enabled:

```bash
DB_DATABASE=/tmp/m12labs_admin_acl_test.sqlite \
SKIP_MIGRATIONS=false \
vendor/bin/phpunit tests/Integration/Api/Application/Api/ApiKeyControllerTest.php
```

Frontend verification:

```bash
pnpm --dir frontend run lint
pnpm --dir frontend run build
```

The build compiles Paraglide, TypeScript, and the production Vite bundle. The
current Paraglide project directly compiles only the configured English locale,
so keep the Danish and Russian JSON keys in parity explicitly.

## Deployment

Run the database migration before relying on scoped key creation:

```bash
php artisan migrate --force
```

After deployment, review keys marked “Legacy unrestricted” in the admin key list
and rotate them to explicit scopes as integrations permit.

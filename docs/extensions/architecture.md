# Extension System Architecture

How installable extension packages are structured, installed, surfaced, and
secured in the M12Labs panel. Authoring guides (how to *write* an extension)
live in the separate extensions repo; this document describes the panel side.

> Extension packages are developed and published from the separate
> `M12Labs-Extensions` repository and installed here through the repository
> installer. Nothing under the two install roots is tracked in this repo
> (`.gitignore`).

## Two install roots

The installer copies files into exactly two allowlisted roots, enforced by
`ExtensionPackageArtifactService::normalizeTargetPath()`:

- `app/Extensions/Packages/<id>/` — backend (controllers, form requests,
  services, `routes/client.php`, `routes/admin.php`, `database/migrations/`,
  `schedule.php`, `Console/Commands/`).
- `frontend/src/extensions/packages/<id>/` — frontend package (`meta.json`,
  `index.tsx` server page, `admin.tsx` admin page, helpers).

Paths containing `..`, absolute paths, or anything outside those two prefixes
are rejected. This allowlist is unchanged by the v2 features — everything new
lives inside the existing roots.

## Manifest schema

Each package ships `m12labs-extension.json` (built from the source
`extension.json`). Relevant keys:

```jsonc
{
  "manifestVersion": 2,               // absent => 1; >2 rejected as "newer panel"
  "package": { "id": "...", "version": "..." },
  "extension": {
    "id": "...", "name": "...", "description": "...",
    "author": "...", "icon": "...",
    "route": "server_route" | null,   // null = admin-only, no server page
    "admin": {                        // v2: contributes an admin page
      "route": "slug", "label": "Node Health", "icon": "server"
    },
    "settingsSchema": [ /* see settings-schema */ ],
    "defaults": { "enabled": false, "allowedNests": [], "allowedEggs": [], "settings": {} }
  },
  "backend": {                        // v2 capability declarations
    "migrations": true,               // must match presence of migration files
    "schedule": true,                 // must match presence of schedule.php
    "commands": ["p:ext:<id>:..."]
  },
  "compatiblePanelVersions": ["Alpha 3.0"],
  "files": [ { "path": "...", "sha256": "..." } ]
}
```

Validation lives in `ExtensionPackageArtifactService::normalizeManifest()` →
`assertValidManifestSchema()`. It rejects: `manifestVersion` > supported;
malformed `admin` blocks; a `backend.migrations`/`backend.schedule` declaration
that disagrees with the actual file list; and any v2 feature under a v1
manifest.

`compatiblePanelVersions` is currently an **exact string match** against
`config('app.version')` (today `Alpha 3.0`). See [ROADMAP](ROADMAP.md) for the
planned semver-range matching.

## The five surfaces

| Surface | Files | Mount / loader | Gate |
|---|---|---|---|
| Server page | `frontend/.../index.tsx` + `meta.json.route` | `pages/server/extensions/registry.ts` glob → sub-route under `/server/:id/extensions/<route>` | `extension.*` perm + `EnsureExtensionAccess` (config enabled, nest/egg eligibility, subuser disable) |
| Client API routes | `app/.../routes/client.php` | globbed in `routes/api-client.php`, **skipped unless enabled** | not loaded when disabled + `extensions.access:<id>` middleware |
| Admin page | `frontend/.../admin.tsx` + `meta.json.admin` | `routes/extensionAdmin.routes.ts` glob → `/admin/extensions/<route>` | `extensions.read` perm + `FeatureGate` + `f.extensions.active` includes id |
| Admin API routes | `app/.../routes/admin.php` | globbed in `routes/api-application.php` under `/ext/<id>`, **skipped unless enabled** | not loaded when disabled + `extensions.admin:<id>` middleware |
| Scheduled tasks / commands | `app/.../schedule.php`, `Console/Commands/` | `ExtensionScheduleService` + `Console\Kernel::commands()`, **skipped unless enabled** | schedule + command classes loaded only for **enabled** extensions (a disabled extension's commands are unregistered) |

### Load-time enforcement (disabled = not loaded)

`ExtensionConfig.enabled` is enforced at **load time**, not merely at request
time. Every backend load site — the admin-routes glob, the client-routes glob,
and the command-directory loader — first consults
`ExtensionRuntimeGate::enabledExtensionIds()` and `require`s/`load`s **only**
enabled extensions. A disabled extension's PHP is therefore never included, so
its top-level code (route registrations, class static initializers, anything at
file scope) cannot execute at all — the request-time middleware 404 is a second
layer, not the primary boundary.

`ExtensionRuntimeGate` is deliberately backed by the two live authorities and
**no cache**: the filesystem glob only finds files that physically exist (so an
uninstalled extension is gone) and the enabled set is queried live from
`ExtensionConfig` (so a disabled extension is filtered out). There is no
generated manifest that could go stale and re-admit removed or disabled code.

Because extension routes are registered at boot from this set, a **cached route
table** (`php artisan route:cache`) would freeze it. The panel does not cache
routes by default; if you enable route caching, the admin controller clears a
stale cache on enable/disable/install/uninstall, but you should re-run
`route:cache` as part of any deploy. The frontend admin-page bundle is the one
surface still gated only at runtime (the compiled JS ships regardless of enabled
state) — this is intentional, since the JS is inert without the now-hardened
API.

### Admin page discovery

`meta.json` gains an optional `admin` block; the page component is
default-exported from a **separate `admin.tsx`** so a server-only extension
never loads admin code (and vice versa). `extensionAdminRoutes` emits a
`RouteDef` per package into `adminRoutes`, grouped under the `extensions` nav
category. Enabled state reaches the SPA through the admin-only
`everestConfiguration.extensions.active` list (`EverestComposer`); the
`extensions.admin` middleware enforces the same state server-side, so a stale
SPA still gets 404s from the API.

### Admin API routes — security

The glob derives the `/ext/<id>` prefix and the `extensions.admin:<id>`
middleware from the **package directory name**, never from the route file, so a
package cannot claim another's namespace or register unguarded routes. Admin
authentication (`AuthenticateApplicationUser`), 2FA, and throttling are
inherited structurally from the `application-api` group wrapping
`routes/api-application.php` and cannot be opted out of — except via
`withoutMiddleware()`, which is prohibited (scanner `block`-severity, review
checklist). Extension controllers must use FormRequests extending
`ApplicationApiRequest` with a `permission()` method for fine-grained checks.

## Database migrations

Extensions ship migrations under
`app/Extensions/Packages/<id>/database/migrations/` (anonymous-class
migrations). `ExtensionMigrationService` wraps the framework `migrator` scoped
to that path. Tables must use the `ext_<id>_` prefix
(`assertTablePrefixConvention` rejects `Schema::create` outside it; the scanner
flags it too).

Pipeline placement (`ExtensionPackageInstallService`):

1. copy files → 2. **run migrations** (`migrating` stage) → 3. rebuild panel
(`pnpm build`) → 4. finalize DB records.

Running migrations before the expensive rebuild means a bad migration aborts
early. On failure the partial batch is rolled back, a log is written (see
below), and the operation aborts. Rollback ordering matters: migrations roll
back **before** files are removed, because the migrator needs the migration
files' `down()` methods still on disk.

Updates run only newly-added migrations (Laravel skips already-ran filenames);
a failed update rolls back just that batch, never pre-existing migrations.

## Uninstall & data handling

**Data is preserved by default.** A plain uninstall removes files and DB
records but leaves the extension's `ext_<id>_*` tables and their `migrations`
rows intact — reinstalling the same version reattaches to the existing data.
The CLI/API surface the preserved table list and generated manual-cleanup SQL.

**Opt-in drop** (`--drop-data` on the CLI, `{ drop_data: true, confirm: "<id>" }`
on the API, checkbox + type-to-confirm in the admin drawer) rolls the
extension's migrations back (dropping the tables) **before** files are removed.
This path is closely audited:

- Every drop — success or failure — writes
  `storage/logs/extension-migrations-<id>-<timestamp>.log` recording the
  initiator, affected tables, migration files, migrator output, and any
  exception (`ExtensionMigrationService::writeMigrationLog`).
- A successful drop also records an `admin:extensions:data-drop` activity-log
  entry.
- If the rollback fails, the uninstall is aborted (files restored) and the
  thrown error names the log file and includes the manual `DROP TABLE …` +
  `DELETE FROM migrations …` SQL as a fallback.
- Requires a typed confirmation of the extension id (CLI `--drop-data` without
  `--force`, API `confirm` field, UI text input). Dropped data is
  unrecoverable, including if a later uninstall step fails and the schema is
  re-applied on rollback (the tables come back empty).

Batch uninstall never drops data — the audited drop is single-extension only.

## Install pipeline reference

`ExtensionPackageInstallService` → `performInstallFileOps` (download → verify
archive sha256 → extract → `normalizeManifest` → compat gate → path-allowlisted
file plans with per-file sha256 + backups → copy → **migrations**) → rebuild →
`finalizeInstall` (DB transaction: `ExtensionPackage`, `ExtensionPackageFile`
ledger, default `ExtensionConfig`). `ExtensionOperationLockService` serializes
install/update/uninstall. Progress stages (incl. `migrating`) flow through
`ExtensionInstallProgressService` and the admin `OperationProgress` banner.

## Trust & security model

There is **no sandboxing**: installed extensions run arbitrary PHP (backend)
and JS (built into the bundle). Security rests on:

- **Checksums** — archive + per-file SHA-256 verified on install.
- **Path allowlist** — writes confined to the two package roots; no path may be
  claimed by two extensions.
- **Structural route security** — admin auth inherited, prefixes/middleware
  derived from directory names, `withoutMiddleware()` prohibited.
- **Load-time enabled gate** — a disabled extension's backend code is never
  loaded: the admin-route, client-route, and command globs `require`/`load` only
  ids returned by `ExtensionRuntimeGate::enabledExtensionIds()`, so its
  top-level PHP cannot run at all. Request-time gates (`EnsureExtensionAccess`,
  `extensions.admin`, the admin-page nav condition) remain as defense-in-depth.
  See [Load-time enforcement](#load-time-enforcement-disabled--not-loaded).
- **Table-namespace enforcement** — `ext_<id>_` prefix required.
- **Manual review** — every extension is reviewed and approved before it enters
  the M12Labs-Extensions repo. The repo-side scanner
  (`tools/extension_scanner.py`) is a review aid that flags dangerous PHP/JS
  constructs; it is **not** a panel-side gate.

## Key files

- Install/update/uninstall: `app/Services/Extensions/ExtensionPackage{Install,Update,Uninstall}Service.php`
- Migrations: `app/Services/Extensions/ExtensionMigrationService.php`
- Scheduler: `app/Services/Extensions/ExtensionScheduleService.php` + `app/Console/Kernel.php`
- Manifest/allowlist: `app/Services/Extensions/ExtensionPackageArtifactService.php`
- Admin API glob + middleware: `routes/api-application.php`, `app/Http/Middleware/Api/Application/Extensions/EnsureExtensionAdminAccess.php`
- Admin page registry: `frontend/src/routes/extensionAdmin.routes.ts`
- Enabled-state exposure: `app/Http/ViewComposers/EverestComposer.php`

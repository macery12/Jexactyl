# Extension System Roadmap

Stage 1 (shipped) added: admin pages surface, extension admin API routes,
database migrations (with preserve-by-default / audited `--drop-data`
uninstall), scheduled tasks + extension artisan commands, a repo-side scanner,
docs, and the `node_health_history` example.

The items below are deferred. Each carries enough design detail to resume.

## Event listeners / hooks

Let extensions subscribe to a **curated allowlist** of panel events (server
created/deleted, user registered, power action, backup completed…).

- Proposal: glob `app/Extensions/Packages/*/hooks.php`, each returning a map of
  `EventClass => [listener callables]`, consumed by a service provider that
  registers them only for **enabled** extensions.
- Only events on an explicit allowlist may be subscribed (prevents extensions
  hooking sensitive internals). Listener exceptions must be isolated
  (per-listener try/catch + `report()`), mirroring `ExtensionScheduleService`.
- Scanner: add rules for hook files (no arbitrary `Event::listen`, allowlist
  membership).

## Per-extension admin permission keys

Today admin pages/APIs gate on the static `extensions.read` panel permission.
Allow extensions to declare their own permission keys (e.g.
`ext.node_health_history.read`) backed by a DB-registered permission table so
roles can grant them individually. Requires making `AdminRole` permissions
dynamic rather than class constants.

## Account / dashboard surfaces & widget slots

- **Account/dashboard pages**: registry pattern identical to the admin surface
  (`meta.json` block + `account.tsx`), mounted under the user account area.
- **Named widget slots**: declared injection points on existing pages (server
  console sidebar card, dashboard tile, server row badge). Needs a slot
  registry and a contract for slot components (props, isolation, error
  boundaries).

## Server sub-nav injection

Promote extension server pages from the Extensions gallery to first-class
entries in the server sidebar (icon/label), gated by the same eligibility
middleware.

## Signed packages / publisher keys

Add publisher signatures over the archive (beyond integrity checksums) so the
panel can verify provenance, not just that the bytes are intact.

## DONE

### Database-changes preview + batch drop-data (2026-07-19)

Install, update, and uninstall now surface a "this will modify your database"
review before committing (architecture.md "Database-changes preview"): a
read-only `POST /extensions/{id}/database-plan` endpoint
(`ExtensionDatabasePlanService`, `extensions.read`) reports the tables an
operation will add (parsed from the archive's `Schema::create` on install/
update, downloaded on demand) or drop/preserve (local `ext_<id>_` introspection
on uninstall). The admin UI shows it in `DatabaseChangesModal` (single via the
manage drawer, batch via the action bar).

The audited data-drop is no longer single-extension only: batch uninstall
accepts a per-extension `drop_data` list (`{id, confirm}`, each typed-id
confirmed), and each drop runs the same `handleMigrationData` path — its own
migration log + `admin:extensions:data-drop` activity entry — so the audit
trail stays per-extension.

### Full admin-API capability (2026-07-19)

Extension admin endpoints now have a formal contract (architecture.md
"Extension admin API contract"): a per-user-per-extension rate limiter
(`throttle:api.ext-admin`, default 60/min, asserted by the route guard),
a response-envelope trait (`RespondsWithExtensionEnvelope`), an explicit
no-URL-versioning stance (frontend/backend ship in lockstep), and scanner
`block` rules — no closure route handlers, every public controller action
takes a FormRequest, admin FormRequests define `permission()`.
`node_health_history` refactored as the reference.

### Semver-range panel compatibility (2026-07-19)

`compatiblePanelVersions` entries now accept semver-range constraints
(`>=Alpha 3.0 <Alpha 4.0`, `^3.1`, `3.x`) alongside the original exact strings.
`PanelVersionCompatibilityService` normalizes the panel's `<Stage> <number>`
scheme to semver (`Alpha 3.0` → `3.0-alpha`) and matches via `composer/semver`
(now a direct dependency). See architecture.md "Manifest" section.

### Runtime route-guard audit (2026-07-19)

`ExtensionRouteGuardService` audits every route a package route file registers
(admin and client globs), right after the `require` — so the verdict is baked
into `route:cache`. Routes with middleware exclusions or a missing
`extensions.admin:<id>` gate are dropped to a 404
(`BlockedExtensionRouteController`) and reported via `report()`.

### Paraglide message fragments for extensions (2026-07-19)

Extensions ship localized UI via `messages/<locale>.json` fragments
(namespaced `ext.<id>.`), merged into a second Paraglide pathPattern at panel
build time — no install-allowlist change needed. `node_health_history` is the
en-only pilot; consume via `td()` with fallback.

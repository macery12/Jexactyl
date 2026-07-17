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

## Full admin-API capability

Stage 1 ships the `routes/admin.php` glob. Still to formalize: documented
conventions for versioning extension admin endpoints, response envelopes, and
per-extension rate limits; scanner rules asserting every admin controller
action uses a FormRequest.

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

## Paraglide message fragments for extensions

Extensions currently ship literal English strings because `frontend/messages/`
is outside the install allowlist. Plan: let packages ship a `messages/`
fragment merged into the Paraglide compile input at panel-build time. Requires
extending the allowlist (or a merge step) and the build pipeline.

## Semver-range panel compatibility

Replace the exact-string `compatiblePanelVersions` match
(`assertCompatiblePanelVersions`) with semver-range matching (e.g. `>=Alpha
3.0 <Alpha 4.0`), so packages don't need republishing for every panel point
release.

## Signed packages / publisher keys

Add publisher signatures over the archive (beyond integrity checksums) so the
panel can verify provenance, not just that the bytes are intact.

## Runtime route-guard audit (defense-in-depth)

`withoutMiddleware()` in an extension route file can strip inherited admin auth
at boot. Stage 1 mitigates via scanner block + review. A post-boot audit of the
route collection could assert every `/ext/<id>` route still carries the admin
middleware and fail loudly (or drop the route) otherwise.

## Batch drop-data

Stage 1 restricts the audited data-drop to single-extension uninstall. A batch
drop-data flow (with the same per-extension audit logging and confirmation)
could follow if needed.

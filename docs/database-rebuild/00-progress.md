# Database Rebuild — Progress Log

Goal: collapse the historical migration chain (327 files, 2016→2026) into a clean,
minimal, Laravel 13-idiomatic set that expresses only the **current final schema**,
for fresh installs only.

## Status: Phase 2 (rebuild) — ✅ BUILT & VERIFIED (2026-07-20), uncommitted, awaiting review

| Step | Status | Notes |
|---|---|---|
| Enumerate migrations | ✅ | **327 files**, dated 2016-01-23 → 2026-07-17 (325 at audit cutoff 2026-06-28 + 2 post-audit, see below) |
| Establish ground-truth final schema | ✅ | Full chain run into a **scratch database** (`m12_schema_audit`; live `jexactyldb` untouched). All migrations ran clean on MariaDB 10.11. Result: **82 tables** (+ `migrations`). Dump committed as [fresh-schema.sql](fresh-schema.sql) |
| Schema reference ([01](01-schema-reference.md)) | ✅ | Generated from `information_schema` — exact types/defaults/indexes/FKs; amended 2026-07-20 with `ai_usage_logs.cached` |
| Churn history ([02](02-churn-history.md)) | ✅ | All hotspot sagas traced file-by-file |
| Upstream divergence ([03](03-upstream-divergence.md)) | ✅ | Provenance from git authorship; recommendation: accept divergence + schema-diff safety net |
| Decisions ([04](04-decisions.md)) | ✅ | 11 items; D2/D4 **RESOLVED 2026-07-20** (see 04) |
| Seeder audit | ✅ | `NestSeeder`/`EggSeeder`/`WebhookSeeder` use Eloquent models only — unaffected. Per D4, three **new** seeders added in Phase 2 (email notification settings, invoice settings, theme presets) |
| File-organization | ✅ | Final: **22 files** (see bottom of this file) |
| Live DB backup | ✅ | 2026-07-20: full dump + `.env` copy → `/root/db-backups/` (outside repo); gzip-verified and restore-tested into `m12_backup_verify` (84/84 tables, row counts match), then verify DB dropped |
| Phase 2 (rebuild) | ✅ | 22 files written; legacy chain moved to `database/migrations_legacy/`; 3 new seeders wired into `DatabaseSeeder`; `scripts/schema-diff.sh` added. **Verified** (scratch DB `m12_schema_rebuild`, since dropped): migrate 22/22 clean · `db:seed` clean + idempotent (double-run stable) · full `migrate:rollback` clean · structural diff vs audit ground truth (columns/index-structure/FK-rules via `information_schema`, name-agnostic) showed **only** the whitelisted deltas: `ai_usage_logs.cached` added (D11), `subscriptions`+`subscription_items` omitted (D2), `email_quotas` migrate-date defaults (dynamic by design). [fresh-schema.sql](fresh-schema.sql) regenerated from the rebuilt set (81 CREATEs = 80 tables + `migrations`); `scripts/schema-diff.sh` passes against it. Everything left uncommitted for review. |

### Post-audit migrations (2026-06-28 → 2026-07-20)

- `2026_07_14_000001_add_cached_to_ai_usage_logs_table` — adds
  `ai_usage_logs.cached` `tinyint(1) NOT NULL DEFAULT 0` after `status`.
  **Folded into the rebuild** (file 22) and into [01](01-schema-reference.md).
- `2026_07_17_100001_reset_default_user_language_to_null` — data-only fixup
  (nulls out `users.language`); no-op on a fresh install → pure churn, logged
  in [02](02-churn-history.md).

Note: the live dev DB also contains `ext_node_health_history_snapshots` — an
**extension-managed** table (node_health_history example, Expand/extensions
branch testing). Extension migrations are outside the core chain and this
rebuild's scope.

## Method

1. All 325 migrations executed in order against a fresh scratch DB — the final
   schema is *empirical*, not inferred. Dump: [fresh-schema.sql](fresh-schema.sql).
2. A parser extracted every `Schema::create/table/rename/drop`, `DB::statement`
   and `DB::table` call per migration → per-table operation timeline.
3. Hotspot chains read in full and narrated in [02](02-churn-history.md).
4. Provenance from `git log --diff-filter=A` original authorship per file
   (history reaches back to Pterodactyl's first commit, 2015).

## Key counts

- **327** migration files → **82** final tables (**80** in the rebuild after D2
  drops the two dead Cashier tables).
- **~113 of 327 files are pure churn** relative to a fresh install: 13 dead-table
  lifecycles, 7 table renames, ~26 data-only fixups (egg regex fixes, backfills,
  renames of game names, the 2026-07-17 `users.language` null-reset), and dozens
  of add→alter→drop column chains.
- True dead tables (create→drop, omit from rebuild): `downloads`,
  `node_configuration_tokens`, `api_permissions`, `permissions`, `tasks_old`,
  `service_packs`/`packs`, `daemon_keys`, `locations`, `email_logs`,
  `email_global_settings`, `curseforge_request_logs`.
- Table renames collapsed: `service_packs→packs`(→dropped),
  `database_servers→database_hosts`, `tasks→tasks_old`(→dropped),
  `services→nests`, `service_options→eggs`, `service_variables→egg_variables`.
- Drop-and-recreate survivors (rebuild keeps final shape only):
  `server_transfers`, `alert_user`, `extension_file_snapshots`.
- Churn hotspots (migrations touching table): `servers` 50 · `nodes` 25 ·
  `users` 18 · `orders` 16 · eggs lineage 24 · `api_keys` 13.

## Working log

- 2026-07-13: Phase 1 started; scratch DB migrated (325/325 DONE, zero errors);
  ground-truth schema dumped; op-timeline extracted; docs 00–01 written.
- 2026-07-13: Hotspot sagas traced (servers, nodes, users, eggs lineage, billing,
  api_keys, email, tasks/schedules, subusers/permissions, databases, allocations,
  backups, alerts, extensions). Doc 02 written.
- 2026-07-13: Provenance classified via git authorship; doc 03 written with
  recommendation. Doc 04 written (10 decisions, 2 need confirmation). Seeders
  audited — model-based, unaffected. Phase 1 complete.
- 2026-07-20: Phase 2 started. Post-audit delta reviewed (2 new migrations, one
  schema-affecting). D2/D4 resolved by user (drop `subscriptions` tables only;
  seed rows move to seeders). File layout finalized at 22 files. Live DB backed
  up to `/root/db-backups/` and restore-verified before any file changes.

---

## Final file organization for the rebuilt migrations

**Decision (2026-07-20): 22 domain-grouped migration files (max ~5 tables each),
FK-dependency ordered, timestamped `2026_07_20_000001`…`000022` (the rebuild
date; sequence suffix preserves FK order).**
The original 14-file proposal was split further at the user's request — the
larger domain files (billing at 13 tables, users/auth at 8) were hard to review;
the 22-file split keeps every file readable top-to-bottom. Rationale for
domain-grouping over the alternatives is unchanged:

Why this and not the alternatives *found in this codebase's actual shape*:

- **Not per-table (82 files):** two-thirds of the final tables are small fork
  feature tables that arrive in natural clusters (4 custom-domain tables created
  the same day, 7 email tables in one batch, 5 extension tables in two batches).
  Per-table files would recreate directory sprawl with no history to justify it.
- **Not monolithic (1 file):** `servers` + billing + email in one file is
  ~2,000 lines; unreviewable, and a single failure point mid-migrate leaves a
  half-created schema that's hard to reason about.
- **Domain grouping matches provenance boundaries** (03): core-panel files stay
  recognizably Pterodactyl-ish (easing manual upstream ports), fork domains are
  self-contained files you can read top-to-bottom to understand a feature's data
  model.

Final files (creation order = FK dependency order; timestamps
`2026_07_20_000001`…`000022`):

| # | File | Tables |
|---|---|---|
| 01 | `create_framework_tables` | `jobs`, `failed_jobs`, `sessions`, `notifications`, `password_resets`, `password_reset_tokens`, `settings` |
| 02 | `create_users_tables` | `admin_roles`, `users`, `recovery_tokens`, `user_ssh_keys`, `user_sessions` |
| 03 | `create_api_tables` | `api_keys`, `api_logs`, `jguard_delay` |
| 04 | `create_nests_and_eggs_tables` | `nests`, `eggs`, `egg_variables` |
| 05 | `create_nodes_and_allocations_tables` | `database_hosts`, `nodes`, `allocations` (server FK deferred, see note) |
| 06 | `create_servers_tables` | `servers`, `server_variables`, `subusers`, `server_transfers` + deferred `allocations.server_id` FK |
| 07 | `create_schedules_and_tasks_tables` | `schedules`, `tasks`, `tasks_log` |
| 08 | `create_server_storage_tables` | `backups`, `databases` |
| 09 | `create_server_groups_tables` | `server_groups`, `server_group_members`, `server_presets` |
| 10 | `create_mounts_tables` | `mounts`, `egg_mount`, `mount_node`, `mount_server` |
| 11 | `create_activity_tables` | `audit_logs`, `activity_logs`, `activity_log_subjects` |
| 12 | `create_billing_catalog_tables` | `categories`, `products`, `billing_cycles`, `coupons` |
| 13 | `create_orders_and_payments_tables` | `orders`, `coupon_usage`, `payment_transactions`, `billing_exceptions` |
| 14 | `create_invoices_tables` | `invoices`, `invoice_settings`, `user_billing_profiles` |
| 15 | `create_email_delivery_tables` | `email_deliveries`, `email_delivery_attempts`, `deferred_emails` |
| 16 | `create_email_settings_tables` | `email_notification_settings`, `email_quotas`, `resend_quotas` |
| 17 | `create_extension_tables` | `extension_configs`, `extension_file_snapshots`, `extension_repositories` |
| 18 | `create_extension_marketplace_tables` | `extension_packages`, `extension_package_files`, `plugin_provider_rules`, `marketplace_install_logs`, `download_queue` |
| 19 | `create_custom_domain_tables` | `custom_domains`, `server_custom_domains`, `custom_domain_api_keys`, `custom_domain_dns_logs` |
| 20 | `create_support_tables` | `tickets`, `ticket_messages`, `alerts`, `alert_user` |
| 21 | `create_ui_tables` | `custom_links`, `webhook_events`, `theme`, `theme_presets` |
| 22 | `create_ai_tables` | `ai_conversations`, `ai_messages`, `ai_usage_logs` (incl. post-audit `cached` column) |

Total: **80 tables** — 82 audited minus `subscriptions` + `subscription_items`
(dropped per D2 resolution).

Notes:

- **One deliberate circular FK**: `servers.allocation_id → allocations.id` and
  `allocations.server_id → servers.id`. Resolution (same as history): create
  `allocations` without the server FK in file 04, add it in file 05 after
  `servers` exists. This is the only cross-file `Schema::table` in the set.
- Conventions per task ground rules: anonymous migration classes, explicit column
  types matching [01](01-schema-reference.md) exactly, inline
  `$table->foreign(...)`/`foreignId` where widths allow, `down()` drops in
  reverse order.
- Old files move to `database/migrations_legacy/` until fresh-install
  verification passes (see D7).
- Verification for Phase 2: migrate a fresh scratch DB with the new set, dump,
  and diff against [fresh-schema.sql](fresh-schema.sql) — must be identical
  modulo migration-name bookkeeping and index-name noise (index names derived
  from historical table names, e.g. `service_variables_*` on `egg_variables`,
  will legitimately change; the diff review will whitelist name-only changes).

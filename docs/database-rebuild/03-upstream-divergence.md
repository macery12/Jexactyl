# Upstream Divergence: Pterodactyl / Jexactyl / M12Labs

Provenance was established from git history (this repo's history goes all the way
back to Dane Everitt's first commit, 2015-12-06), by looking at the **original
author of each migration file**, not by guessing from dates.

## Migration-file provenance (325 files)

| Origin | Authors | Files |
|---|---|---:|
| Pterodactyl upstream | Dane Everitt, Matthew Penner, Lance Pioch, community contributors | ~197 |
| Jexactyl fork | cmrxnn, camwhit-e/camwhi-te/camw0, AreYouScared, Gio | ~45 |
| M12Labs | macery12, copilot-swe-agent[bot], Copilot | ~83 |

The last migration inherited from Pterodactyl upstream is
`2023_02_23_191004_add_expires_at_column_to_api_keys_table` (Pterodactyl 1.11).
Everything after that is fork-original.

## Table provenance (82 final tables)

**Pterodactyl core (30):** `activity_logs`, `activity_log_subjects`, `allocations`,
`api_keys`, `api_logs`†, `audit_logs`†, `backups`, `databases`, `database_hosts`,
`eggs`, `egg_mount`, `egg_variables`, `failed_jobs`, `jobs`, `mounts`,
`mount_node`, `mount_server`, `nests`, `nodes`, `notifications`,
`password_resets`, `recovery_tokens`, `schedules`, `server_transfers`,
`server_variables`, `servers`, `sessions`, `settings`, `subusers`, `tasks`,
`tasks_log`†, `users`, `user_ssh_keys`. († = vestigial even upstream; see 04.)

**Jexactyl-added (13):** `admin_roles`*, `theme`, `tickets`, `ticket_messages`,
`categories`, `products`, `orders`, `subscriptions`, `subscription_items`,
`jguard_delay`, `custom_links`, `server_groups`, `billing_exceptions`,
`webhook_events`, `server_presets`. (*`admin_roles` was authored by Matthew Penner
in a 2020 Pterodactyl 2.x branch that upstream later abandoned; Jexactyl kept it.)

**M12Labs-added (39):** everything else — the extension system
(`extension_configs`, `extension_file_snapshots`, `extension_repositories`,
`extension_packages`, `extension_package_files`, `plugin_provider_rules`), the
email subsystem (6 tables + `resend_quotas`), custom domains (4 tables), billing
v2 (`billing_cycles`, `coupons`, `coupon_usage`, `payment_transactions`,
`invoices`, `invoice_settings`, `user_billing_profiles`), AI
(`ai_conversations`, `ai_messages`, `ai_usage_logs`), plus `alerts`, `alert_user`,
`user_sessions`, `password_reset_tokens`, `theme_presets`, `server_group_members`,
`marketplace_install_logs`, `download_queue`, `deferred_emails`.

## Divergence already present in inherited tables

Even the "Pterodactyl" tables are no longer upstream-shaped:

- **`locations` deleted entirely** (M12Labs, 2025-03) — upstream still has it and
  its FK on `nodes`. This alone makes most future upstream migrations
  (anything touching locations) unappliable.
- `servers` carries 10+ fork billing/grouping columns; `nodes` carries
  `deployable`, `price_multiplier`, `wings_*`; `users` carries Jexactyl/M12Labs
  auth+billing columns; `egg_variables.field_type`; `subusers.disabled_extensions`;
  `activity_logs.is_admin`/`scope`.
- Upstream Pterodactyl's own future is `v2/panel-next`-shaped (they squashed
  migrations into a schema dump and are moving tables around); their 1.x branch is
  in maintenance and emits very few new migrations.

## Recommendation: accept full divergence, keep a schema-diff safety net

**Recommendation: treat the schema as M12Labs-owned and stop pretending upstream
migrations can be replayed. Do not build a reconciliation layer into the
migrations themselves.** Reasoning:

1. Replaying upstream migrations is *already* impossible — the `locations` drop,
   the renamed/removed columns and the fork columns occupying `after()` positions
   mean any nontrivial upstream migration would need hand-editing anyway. The
   "stay compatible" option died in 2025-03, before this rebuild.
2. Upstream 1.x produces roughly 2–5 migrations *per year* at this point.
   Hand-porting them is minutes of work each; engineering a compatibility scheme
   to automate that is not worth its carrying cost.
3. What actually matters is *not missing* an upstream change (a wings-required
   column, a security fix). That needs awareness, not compatibility.

**Safety net (cheap, recommended for Phase 2):** keep the empirical schema dump
(`mysqldump --no-data` of a fresh install) committed as a build artifact, e.g.
`docs/database-rebuild/fresh-schema.sql`, regenerated whenever migrations change.
When upstream publishes a new migration:

- port it by hand as a **new M12Labs migration** on top of the consolidated set
  (never by editing the consolidated files after release), and
- diff the regenerated dump to confirm intent.

A small `scripts/schema-diff.sh` (migrate scratch DB → dump → `git diff` against
the committed dump) makes schema drift visible in code review with ~20 lines of
shell. That is the entire recommended upstream story.

**Tradeoff being accepted:** merging upstream via `git merge` of their migration
files becomes permanently impossible (it effectively already is), and porting
burden is manual forever. In exchange the migration set stays clean, and fresh
installs stop depending on 10 years of replayed history.

# Migration Churn History

How the 325-file migration chain (2016-01 → 2026-06) actually evolved, table by
table, for every churn hotspot. Each section ends with the **final state** that the
rebuilt migrations must produce (cross-checked against the empirical schema in
[01-schema-reference.md](01-schema-reference.md)).

Conventions: `A → B` means a column/table rename; "reverted" means a later
migration undid an earlier one.

---

## Dead tables (created, then later dropped — omit entirely from the rebuild)

| Table | Created | Dropped | Notes |
|---|---|---|---|
| `downloads` | 2016-01 | 2017-05 (`DeleteDownloadTable`) | daemon download tokens, replaced by signed JWTs |
| `node_configuration_tokens` | 2017-01 | 2017-05 (`DeleteNodeConfigurationTable`) | |
| `api_permissions` | 2016-01 | 2018-01 (`AddApiKeyPermissionColumns`) | replaced by `r_*` columns on `api_keys` |
| `permissions` | 2016-01 | 2020-03 (`drop_permissions_table`) | merged into `subusers.permissions` JSON |
| `tasks_old` | 2017-09 (rename of original `tasks`) | 2017-09 (`TransferOldTasksToNewScheduler`) | scheduler refactor, see Tasks section |
| `tasks_log` | 2016-02 | **never dropped** | ⚠️ still exists but orphaned — see 04-decisions |
| `service_packs` → `packs` | 2016-11 / renamed 2017-03 | 2020-09 (`drop_packs_table`) | pack system removed; also dropped `servers.pack_id`, `api_keys.r_packs` |
| `daemon_keys` | 2017-09 | 2020-09 (`drop_daemon_key_table`) | daemon auth moved to node tokens |
| `locations` | 2016-01 | **2025-03 (`remove_locations_table`) — M12Labs change** | `nodes.location_id` FK dropped 2025-03, column dropped 2025-04 |
| `email_logs` | (Jexactyl-era) | 2026-03 (`cleanup_and_create_email_deliveries`) | replaced by `email_deliveries` |
| `email_global_settings` | (Jexactyl-era) | 2026-03 | replaced by `email_notification_settings` |
| `curseforge_request_logs` | 2026-01 | 2026-06 (`drop_curseforge_request_logs_table`) | lived ~4 months |
| `database_servers` | 2016-02 | renamed → `database_hosts` 2017-03 | survives under new name |

**Drop-and-recreate in place** (table survives; rebuild should create only the final
shape): `server_transfers` (2020-04 migration does `dropIfExists` + `create`),
`alert_user` (2025-12, same pattern), `extension_file_snapshots` (2026-02 drops or
renames the old copy to `…_legacy`, then creates fresh — on a fresh install the
`_legacy` table never exists).

---

## servers — 50 migrations, the worst hotspot

The original 2016 table barely resembles the final one.

1. **2016**: created with `node`, `owner`, `service`, `option` (bare names),
   inline `ip`/`port`, `active`, `daemonSecret`, `username`/`sftp_password`.
2. **2016**: `ip`/`port` replaced by `allocation` FK (`modify_ip_storage_method`);
   `active` → `suspended` (added then `active` dropped); docker `image` column added.
3. **2016-10**: FKs added, plus `softDeletes` — **reverted 2017-04**
   (`DropDeletedAtColumnFromServers`).
4. **2017-02** (`UpdateColumnNames`): the big rename — `node→node_id`,
   `owner→owner_id`, `allocation→allocation_id`, `service→service_id`,
   `option→option_id`, `pack→pack_id`.
5. **2017-09/10**: `daemonSecret` dropped (moved to `daemon_keys`, itself dropped
   2020); `service_id→nest_id`, `option_id→egg_id` (nests/eggs conversion);
   `username`/`sftp_password` dropped.
6. **2018–2020**: `external_id`, `database_limit`/`allocation_limit`
   (allocation_limit default 0 → **re-defaulted to NULL** in 2019), `threads`,
   `backup_limit`, `pack_id` dropped.
7. **2021** (`add_generic_server_status_column`): `suspended` + `installed`
   collapsed into nullable string `status`; `startup` made nullable.
8. **2023**: `oom_disabled` (default 0) → **inverted** to `oom_killer` (default 1).
9. **2024–2026 (fork era)**: billing fields with heavy churn —
   `order_id` added 2024-12 → **dropped 2025-08** for `billing_product_id`;
   `days_until_renewal` added 2024-12 → **replaced 2025-08** by `renewal_date`
   (`date`) → fixed for zero-dates 2025-09 → **retyped `datetime` 2025-12**;
   `group_id` added 2024-12 → **dropped 2026-06** for the `server_group_members`
   pivot; plus `subuser_limit`, `mods_enabled`, `billing_days`, `billing_amount`,
   `subdomain_limit`, `last_plan_change_at`, deletion-schedule trio
   (`deletion_scheduled_at/by`, `deletion_canceled_at`), index on `renewal_date`.

**Final state**: see `servers` in 01. No `deleted_at`, no `suspended`/`installed`,
no `pack_id`/`order_id`/`group_id`/`days_until_renewal`. `oom_killer` tinyint
default 1. `renewal_date` is `datetime`.

## nodes — 25 migrations

- 2016: created with `location`, `daemonSecret`, `daemonListen`/`daemonSFTP`/`daemonBase`.
- 2017: `location→location_id`; `behind_proxy`; over-allocation columns made
  signed with default 0.
- 2020 (`store_node_tokens_as_encrypted_value`): `uuid` + `daemon_token_id` added,
  `daemonSecret→daemon_token` (text, encrypted).
- 2021: `database_host_id` **moved here from `database_hosts.node_id`** (direction
  of the relationship flipped); `daemonListen→listen_port_http`,
  `daemonSFTP→listen_port_sftp`, `daemonBase→daemon_base`, plus new
  `public_port_http`/`public_port_sftp`.
- **2025 (M12Labs): `location_id` FK then column dropped — locations concept
  removed entirely.**
- Fork additions: `deployable` (2024), `deployable_free` (2025),
  `price_multiplier` + `price_multiplier_description` (2026),
  `wings_type`/`wings_version`/`wings_detected_at` (2026, wings-rs detection).

## users — 18 migrations

- 2016: created with `name_first`/`name_last` (added 2017) → **dropped 2021**
  (`yeet_names_from_users_table`).
- `external_id`: added 2017 as unsigned int unique → retyped string 2018 →
  unique dropped 2018-02-10 → plain index re-added 2018-02-25. Three migrations
  in one month fighting over one column.
- `totp_secret`: char(16) → text (encrypted) 2017; `totp_authenticated_at` added
  (**`timestamptz`** — the only tz-aware column family in the schema).
- `language`: char(5) → varchar(5) via raw SQL (2022). Post-audit
  (`2026_07_17_100001`): data-only null-reset of every row's `language` (values
  were an old model default, not user choices) — no-op on fresh installs, +1 to
  the users churn count (now 18 migrations).
- 2019 (`create_customer_columns`, Cashier-style): `stripe_id`, `pm_type`,
  `pm_last_four`, `trial_ends_at`. Note: 2026_05_24 re-adds `stripe_id` guarded by
  `hasColumn` — a no-op on fresh installs (both migrations exist; only the 2019 one
  takes effect).
- Fork era: `admin_role_id` (2021, FK→`admin_roles`), `state` (2024),
  `recovery_code`/`recovery_code_seen` (2024), `email_verified_at` +
  `email_verification_token` (2026).

## services → nests / service_options → eggs / service_variables → egg_variables

The single biggest conceptual refactor (Pterodactyl 0.7, Oct 2017):

- `services`: lost `file`/`folder`, `executable`, `startup`, `index_file` through
  2017; gained `uuid`, author changed from UUID-string to email. Renamed → `nests`.
- `service_options`: `parent_service→service_id→nest_id`; `tag` dropped for
  `uuid`+`author`; gained `config_*` columns (2017), `script_*` columns (2017),
  `copy_script_from`/`config_from` self-FKs. Renamed → `eggs`.
  - Later: `docker_image` (text) → **`docker_images` JSON** (2020), `file_denylist`
    text → **dropped & re-added as JSON** (2021), `config_logs` **dropped** (2021),
    `features` JSON, `update_url`, `force_outgoing_ip` (2022),
    script defaults changed to `ghcr.io/pterodactyl/installers:alpine` / `/bin/ash`.
- `service_variables`: `option_id→egg_id`; `regex` → `rules` with data conversion,
  `required` column folded into the rules string (2017); `default_value` → text.
  Renamed → `egg_variables`. Fork addition: `field_type` (2026, default `'text'`).
- ~10 pure data-fixup migrations (Insurgency/TF2 rename, BUNGEE_VERSION typo,
  ARK insert, Spigot regexes, …) are irrelevant to fresh installs — the rebuilt set
  drops them; seed data comes from `NestSeeder`/`EggSeeder`.

## tasks / schedules — full subsystem replacement (2017-09)

Original cron-style `tasks` (per-server, `year/month/day/…` columns) + `tasks_log`.
Refactor: `tasks` renamed `tasks_old` → new `schedules` (cron fields) + new `tasks`
(sequenced actions per schedule) → data copied → `tasks_old` dropped.
**`tasks_log` was forgotten and still exists, orphaned, with a dangling
`task_id`** (no FK). Later additions: `cron_month` (2021), `only_when_online`,
`continue_on_failure` (2021).

## subusers / permissions

- `subusers.daemonSecret` dropped 2017 (→ `daemon_keys`).
- `permissions` table: `permissions→permission` rename (1 week after creation),
  pivoted to `subuser_id` (2017), then whole table **merged into
  `subusers.permissions` JSON** (2020-03) and dropped.
- Fork addition: `subusers.disabled_extensions` JSON (2026).

## api_keys — 13 migrations

- 2016: `public` char(16) + `secret` text pair.
- 2017 (`MigratePubPrivFormatToSingleKey`): collapsed to single `token` char(32)
  unique, `public` dropped, `user→user_id`.
- 2018: `api_permissions` table dropped in favor of ten `r_*` tinyint columns
  (`r_packs` dropped again 2020); `identifier` char(16) unique added; `token`
  → text (encrypted), token unique dropped; `key_type` added; `expires_at`
  **dropped 2018 → re-added 2023**. Net effect of the 2016+2018 pair: exists.
- `memo`, `allowed_ips`, `last_used_at` survive.

## orders / payments / invoices (fork billing saga, 2024-12 → 2026-06)

- `orders` created 2024-12; then 15 further migrations: `payment_intent_id` added
  NOT NULL (2024-12) → **made nullable 2026-05**; `is_renewal` **dropped** for
  `type` string (2025-08); `threat_index`, coupon columns, `egg_id`/`node_id`/
  `server_id`/`variables`/`domain_payload`, `payment_processor`, `payment_token`,
  eight `paypal_*` columns (2026-01), billing-cycle columns (`billing_days`,
  `final_price`, `multiplier_used`, `node_multiplier_used`), `product_name`,
  indexes on `user_id`/`paypal_order_id`.
- 2026-05: `payment_transactions` introduced as the normalized ledger; three data
  migrations backfill it from the orders columns. **The legacy `payment_intent_id`
  and `paypal_*` columns on `orders` were never dropped and are still read/written
  by `CheckoutController`, `PayPalWebhookController`, etc.** — they stay.
- `invoices` (2026-05-30): created, then **reshaped 4 migrations later the same
  day**: `file_path/file_disk/file_size_bytes → data_path/data_disk/data_size_bytes`,
  `metadata` dropped, `pdf_cached_*` columns added. `invoice_settings`:
  `retention_days` **dropped** for `auto_cleanup_enabled`/`auto_cleanup_after_years`;
  `storage_config` json → text.
- `products` (2024): `category_id` int (2024-04) → **dropped for `category_uuid`**
  (2025-03); `base_price`, `subdomain_limit` added 2026.

## email subsystem (2026-03) — replaced wholesale

`email_logs` and `email_global_settings` dropped; `email_deliveries`,
`email_delivery_attempts`, `deferred_emails`, `email_notification_settings`,
`email_quotas`, `resend_quotas` created. These migrations are written
defensively (every column guarded by `hasColumn`, every index by a custom
`indexExists`) because they had to converge divergent installs — on a fresh
install only the `create` branches run. The rebuild keeps just the create-shape.
Note `email_notification_settings`' migration also **seeds default rows**
(`seedDefaultNotificationSettings()`) — this must move to a seeder or stay in the
rebuilt migration (see 04-decisions).

## databases / database_hosts

`database_servers` → `database_hosts` (2017); `db_server → database_host_id`;
`linked_node → node_id` → **column removed entirely 2021** when the FK moved to
`nodes.database_host_id`. Unique keys on `databases` changed twice:
(`database`), (`username`) global uniques → per-host (2019) → per-host-per-server
(2020): final uniques are (`database_host_id`,`server_id`,`database`) and
(`database_host_id`,`username`).

## allocations

`node→node_id`, `assigned_to→server_id` (2017); `ip_alias` added 2016;
`notes` added 2020; unique (`node_id`,`ip`,`port`) 2017; FK behavior churn:
server FK → `SET NULL` on delete (2017), node FK → `CASCADE` (2017).

## backups

Created 2020 (with a bizarre guard renaming pre-existing `backup%` tables from a
0.7 plugin era — irrelevant for the rebuild). `sha256_hash → checksum` (+ data
prefix rewrite), `bytes` → unsigned bigint, `is_successful` default true →
**false** (2021), `is_locked` added, `ignored_files` made nullable, `upload_id`
added. Keeps `softDeletes` (`deleted_at`).

## alerts (fork, 2025-12)

Four migrations in ten days: create → scope/button columns → `alert_user` pivot +
`user_targeting` enum → `position` values consolidated (`bottom-*` → `slide-out`)
via raw `MODIFY COLUMN` with an informal enum comment.

## Minor/one-shot notes

- `settings`: created 2016 as key/value with `key` as the only (unique) column
  pair; 2017 (`MigrateSettingsTableToNewFormat`) truncated it and prepended an
  `increments('id')` primary key. Final: `id` PK + unique `key` + `value` text.
- `jobs`/`failed_jobs`: 2016 create + 2016-09 update pair each (queue driver
  modernization); `failed_jobs` gained `uuid` unique (2021-era Laravel convention).
- `activity_logs` (2022) replaced `audit_logs` (2021) functionally, but
  **`audit_logs` was never dropped** — still present. Fork added `is_admin`
  (2025) and `scope` (2026) to `activity_logs`.
- `mounts` trio (2020): pivots got proper FKs only in 2021, with orphan-row
  cleanup first.
- `theme` (2024, Jexactyl) then `theme_presets` (2026-05, M12Labs) —
  `theme_presets` re-seeded/expanded 2026-06 (`refresh_theme_presets_expanded_palette`).
- `jguard_delay` (2024, Jexactyl anti-abuse): got unique index + cascade FK to
  users only in 2026-04, with orphan cleanup.
- `user_sessions` (2026-02): custom session tracking; `device_label` added
  2026-06 (Account Security refactor).
- `custom_domains` family (2026-02): 5 tables created within a day of each other,
  minor alters within the same month (`server_custom_domains` got 2 alters,
  `custom_domains` 2).

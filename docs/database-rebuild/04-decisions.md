# Decisions & Open Questions

Judgment calls made during the audit, with reasoning, so they can be reviewed and
overridden before Phase 2. Both open items (D2, D4) were **resolved with the user
on 2026-07-20**; D11 records the post-audit migration delta.

## D1. Ground truth = empirical schema, not intent

Where the migration chain is contradictory, the rebuilt migrations reproduce **what
the chain actually produces on MariaDB** (the scratch-DB dump behind
[01-schema-reference.md](01-schema-reference.md)), not what any individual
migration seemed to intend. Example: `users.stripe_id` is defined twice
(2019 + guarded 2026 re-add); the 2019 shape wins because that is what a fresh
install gets.

## D2. Vestigial tables — **RESOLVED 2026-07-20**

**Decision (user-confirmed): drop `subscriptions` + `subscription_items` from the
rebuild** (zero code references — Cashier is not installed; completely safe).
The other four (`tasks_log`, `api_logs`, `audit_logs`, `notifications`) plus the
`password_resets`/`password_reset_tokens` duplication are **kept** because
models/config still reference them; they remain the follow-up cleanup ticket.
Rebuild target is therefore **80 tables**.

Original audit list for the cleanup ticket:

| Table | Evidence |
|---|---|
| `tasks_log` | Orphaned by the 2017 scheduler refactor; `app/Models/TaskLog.php` still exists but nothing meaningful uses it. Upstream deleted it long ago. |
| `api_logs` | `app/Models/APILog.php` exists; upstream dropped this concept in 1.0. No writes found in `app/`. |
| `audit_logs` | Superseded by `activity_logs` (2022) but never dropped. |
| `notifications` | Laravel database-notifications table (2016); `Notifiable` trait is present on models but no database-channel notifications found. |
| `subscriptions` + `subscription_items` | Cashier-style tables added by Jexactyl (2019 dates, authored 2022+); Laravel Cashier is **not** in `composer.json` and no code references them. **→ DROPPED in rebuild.** |
| `password_resets` | Legacy Laravel broker table. Still wired in `config/auth.php`, **but** the active flow (`app/Services/Auth/PasswordResetService.php`) uses `password_reset_tokens`. Both kept; consider consolidating to one. |

## D3. `orders` keeps its legacy payment columns

`payment_transactions` (2026-05) is the normalized payment ledger, but
`orders.payment_intent_id` and the eight `paypal_*` columns are still actively
read/written by `CheckoutController`, `PayPalCheckoutController`,
`PayPalWebhookController`, `CreateOrderService`, `InvoiceGenerationService`.
Rebuild keeps them exactly as-is. (Follow-up refactor could move checkout flow to
`payment_transactions` and drop ~10 columns, but that is app-code work.)

## D4. In-migration data seeding — **RESOLVED 2026-07-20: move to seeders**

Three historical migrations insert rows:

- `email_notification_settings` — migration calls `seedDefaultNotificationSettings()`.
- `invoice_settings` — migration inserts the initial singleton settings row.
- `theme_presets` — `2026_06_28_refresh_theme_presets_expanded_palette` seeds/refreshes preset rows.

**Decision (user-confirmed):** the rebuilt migrations create **structure only**;
default rows move to three new idempotent seeders (`EmailNotificationSettingsSeeder`,
`InvoiceSettingsSeeder`, `ThemePresetSeeder`) registered in `DatabaseSeeder`
(the installer already runs `db:seed`). The `InvoiceSettingsSeeder` row reflects
the **final** column set (including the auto-cleanup and
`require_billing_address` columns added after the original insert); the
`ThemePresetSeeder` ships the current 9-preset expanded (10-color) palette.
Caveat accepted: a bare `php artisan migrate` without `db:seed` yields empty
settings tables — install tooling must run both.

## D5. Collation/charset left to Laravel defaults

The scratch run produced `utf8mb4_unicode_ci` with varchar(191) keys (Laravel's
`defaultStringLength(191)` is set in this app). The rebuild will not hardcode
per-table charsets; it inherits `config/database.php`. The 191 prefix stays
because it's app-config-driven, not migration-driven.

## D6. Type quirks reproduced as-is (not "fixed")

Deliberately preserving oddities so app code doesn't silently break:

- `users.totp_authenticated_at` is `timestamp` (tz-aware upstream intent, but
  MySQL/MariaDB stores plain timestamp) — kept as written.
- `orders.total` is `double` while everything newer is `decimal(10,2)` — kept;
  flagged as a future correctness fix (money in float).
- Mixed FK integer widths: core tables use `int unsigned` (increments), fork
  tables use `bigint unsigned` (id()). Cross-table FKs must match the referenced
  column width — the rebuild preserves each table's current PK width rather than
  standardizing, because standardizing would ripple through every FK and diverge
  from ground truth.
- `alerts.position` is varchar with a COMMENT listing allowed values; kept.
- `email_delivery_attempts` has near-duplicate column pairs (`response_code`/
  `status_code`, `error_message`/`error`, `raw_response`/`response_payload`) —
  artifacts of converging two implementations; kept, flagged for cleanup.

## D7. `migrations_legacy/` retention

Per the task instructions, Phase 2 moves the 327 old files to
`database/migrations_legacy/` rather than deleting. Note: Laravel will not load
them there (only `database/migrations` is registered), so this is purely for
human reference until fresh-install verification passes, then the directory can
be deleted in a follow-up commit (git history preserves them regardless).

## D8. Existing installs — **RESOLVED 2026-07-20: `p:migrate:adopt`**

The rebuilt chain has all-new migration names; the `migrations` table of any
existing database (including the live `jexactyldb` on this box) will not match.
**Do not run `php artisan migrate` from the rebuild branch against an existing
database** — Laravel would see 22 "pending" unknown migrations and try to create
tables that already exist.

Originally scoped as fresh-installs-only. Since resolved: existing installs are
upgraded with **`php artisan p:migrate:adopt`**, documented in
[../panel-upgrade.md](../panel-upgrade.md).

What made this tractable is that the two chains are schema-equivalent. Comparing
the live dev database against the rebuilt schema found **identical columns —
881 on both sides, zero differences** — so the upgrade is bookkeeping plus a
short tail of naming:

- 9 indexes/constraints still carrying pre-rename table names (`service_options_*`
  → `eggs_*`, `services_uuid_unique` → `nests_uuid_unique`, `servers_*_foreign`
  → `servers_*_index`);
- `ticket_messages_ticket_id_internal_note_index` created over `(ticket_id)`
  alone instead of `(ticket_id, internal_note)` — the fluent
  `->unique()->index()` gotcha in the old chain, fixed in the rebuild;
- a redundant `ticket_messages_ticket_id_index`;
- `subscriptions` + `subscription_items` dropped per D2.

Verified by adopting a clone of the dev database and comparing it against a
genuinely fresh `migrate`: **1244 schema facts on each side, zero differences.**

The dev database itself was never touched — all verification ran against clones.

**Revised 2026-07-21.** The above holds for an install that ran the old chain to
completion. Installs that tracked `develop` did not: each stopped at a different
point, so they are missing different subsets of the same tables, columns and
indexes. The original command refused these outright, on the assumption that an
install was either fully migrated or not this panel at all.

It now works from the live schema rather than the migration list, and builds
whatever is missing — tables, columns, indexes and foreign keys — from
`fresh-schema.sql`. Differences that cannot be closed without risking data (a
column that would have to narrow, or one this install has and the shipped schema
does not) are reported instead of forced, and hold back the migration history
rewrite until resolved.

Two failure modes found while doing this, both now fixed:

- MariaDB drops a foreign key's identically-named backing index along with the
  constraint. The plan was computed once up front, so a later index rename
  referred to something the earlier FK rebuild had already removed, and the run
  aborted part-way. Changes are now applied in phases with the plan recomputed
  from the live schema between each.
- A single failing statement aborted the whole run. Failures are now collected
  and the remaining changes still attempted.

**Data decisions (2026-07-21).** Installs that came through a fork
(Pterodactyl → JexPanel → here) turned up two differences that DDL cannot close
on its own, because they turn on what the rows *mean*:

- `users.state` is an integer enum on the fork; this panel reads it as text
  (`NULL`/`'suspended'`/`'pending'`). The type widens losslessly, but which
  integer meant "suspended" is not in the schema. Guessing would silently
  un-suspend or lock out accounts.
- `egg_variables.rules` is NULL on older installs but NOT NULL in the shipped
  schema; tightening it as-is blanks every NULL to `''`, which strips validation
  from those variables with no warning.

Rather than refuse these (stranding the upgrade) or coerce them (losing meaning),
the command now runs a **remediation pass** before the schema plan: it reads the
column's actual value distribution, proposes a safe default, and applies the
`UPDATE`s the operator confirms. A remediation only ever *suggests* — the
per-column knowledge it draws on ([`ColumnRemediation`](../../app/Services/Migration/ColumnRemediation.php),
hints in `SchemaReconciler::remediationHints()`) encodes this panel's meaning for
its own columns, never a guess about the source. Under `--assume-yes` a safe
default (a NULL fill) is taken; a genuine choice (the state remap) is skipped and
holds back the history rewrite, so automation never corrupts. Outstanding
remediations block the bookkeeping rewrite exactly like an unrepairable
difference does.

Two further refinements to what counts as unsafe, from the same dry runs:

- `char(191)` → `varchar(191)` was refused as a change of type family. It holds
  the same values either way, and is now corrected. (`varchar` → `char` still is
  not: padding out and trimming back loses trailing spaces.)
- Signedness was ignored entirely, because the type comparison discarded
  everything after the type's opening parenthesis — so `int(10) unsigned` →
  `int(11)` was applied silently, and could have clamped values above 2³¹. The
  integer display width is now recognised as the no-op MySQL treats it as, and
  signedness compared on its own: the change is applied when no stored value
  falls outside the target range, and reported when one does.

## D9. `products.category_uuid` has no FK

`categories.uuid` exists but `products.category_uuid` was added (2025-03) without
an FK or index. Reproduced as-is; flagged — an index would be cheap and correct.

## D10. `server_transfers.server_id` FK vs `successful` nullable-boolean

Reproduced as today. The drop-and-recreate history means older installs may have
a slightly different shape than fresh ones; fresh shape wins (this is the
fresh-install-only premise applied).

## D11. Post-audit migrations (added 2026-07-20)

Two migrations landed after the 2026-06-28 audit cutoff (chain now 327 files):

- `2026_07_14_000001_add_cached_to_ai_usage_logs_table` — schema change:
  `ai_usage_logs.cached` `tinyint(1) NOT NULL DEFAULT 0` after `status`.
  **Folded into rebuilt file 22** (`create_ai_tables`) and into
  [01-schema-reference.md](01-schema-reference.md). The committed
  `fresh-schema.sql` is regenerated from the rebuilt set, so it includes this
  column.
- `2026_07_17_100001_reset_default_user_language_to_null` — data-only fixup;
  no-op on fresh installs. Logged as churn in
  [02-churn-history.md](02-churn-history.md); nothing to carry into the rebuild.

Also observed on the live dev DB (not in the core chain): the extension-managed
table `ext_node_health_history_snapshots` (node_health_history example from the
Expand/extensions branch). Extension migrations live outside
`database/migrations` and are untouched by this rebuild.

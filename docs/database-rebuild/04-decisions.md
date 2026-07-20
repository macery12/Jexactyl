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

## D8. Existing installs are out of scope — including the dev DB

The rebuilt chain will have all-new migration names; the `migrations` table of any
existing database (including the live `jexactyldb` on this box) will not match.
Fresh installs only, per the task. The dev database was not touched during this
audit (all verification ran against a scratch DB `m12_schema_audit`).
**Do not run `php artisan migrate` from the rebuild branch against `jexactyldb`** —
Laravel would see 325 "pending" unknown migrations. Phase 2 should add a guard
note in the PR description.

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

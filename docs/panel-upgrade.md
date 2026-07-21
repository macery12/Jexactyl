# Upgrading an existing install onto the consolidated migrations

`php artisan p:migrate:adopt` moves an install of **this** panel from the old
327-file migration history onto the consolidated 22-file one.

This is the companion to [panel-import.md](panel-import.md), and the two are
easy to confuse:

| Situation | Command |
|---|---|
| Coming from Pterodactyl, Jexactyl or JexPanel | `p:migrate:import` |
| Already running this panel, upgrading past the schema rebuild | `p:migrate:adopt` |
| Installing this panel for the first time | neither — just `php artisan migrate --seed --force` |

> **This tool is experimental** and has not been tested against a real
> installation. It alters the schema of a live database. Take a
> backup first, run it with `--dry-run` to see exactly what it will do, and
> report problems — with the command output and the version you upgraded from —
> to the automated installer repository.

## Why this is needed

The panel replaced its migration history: 327 files became 22
(see [database-rebuild/](database-rebuild/)). The two chains build the **same 80
tables and the same 881 columns**, so no data has to move. What breaks is the
bookkeeping — an existing database's `migrations` table lists 327 filenames that
no longer exist, so Laravel would see 22 unknown migrations as "pending" and try
to create tables that are already there.

`p:migrate:adopt` reconciles that. It:

1. rewrites the `migrations` table to list the consolidated chain;
2. renames the handful of indexes and foreign keys still carrying names from
   tables that were renamed years ago (`service_options_*` → `eggs_*`, and so
   on);
3. rebuilds one index on `ticket_messages` that the old chain created over the
   wrong columns;
4. drops `subscriptions` and `subscription_items`, which the rebuild removed
   (D2) — **only if they are empty**.

**No row data is read or written**, other than the `migrations` table itself.

## Requirements and ordering

The install must be **fully migrated on the old chain** before upgrading. The
command checks this and refuses otherwise, naming the oldest missing migration.

That check matters because the new code no longer ships the old migration files,
so there is no way to catch up from here. The upgrade path is:

```
# on the last release before the schema rebuild
php artisan migrate --force

# then deploy this version, and
php artisan p:migrate:adopt --assume-yes --no-interaction
```

An installer that upgrades across the rebuild boundary must not skip that first
step. If it deploys the new code onto a database that is behind, the operator
has to check out the older release to recover.

**Do not seed afterwards** — neither `php artisan db:seed` nor
`php artisan migrate --seed`. The egg seeder updates eggs by UUID and would
overwrite any egg definitions the operator has customised.

## Invocation

Interactive:

```bash
php artisan p:migrate:adopt --dry-run   # see the plan
php artisan p:migrate:adopt             # apply it, with confirmations
```

Unattended:

```bash
php artisan p:migrate:adopt --assume-yes --no-interaction
```

### Options

| Option | Effect |
|---|---|
| `--dry-run` | Print the full plan and write nothing. |
| `--keep-vestigial` | Keep `subscriptions` and `subscription_items` instead of dropping them. |
| `--keep-extra-indexes` | Keep indexes this install has that the shipped schema does not. |
| `--assume-yes` | Answer the confirmation prompts yes. **Required for unattended runs.** |

Exit code is `0` on success or when there is nothing to do, `1` on any refusal
or failure.

## Safety properties

- **Idempotent.** Running it twice is a no-op — it detects an install already on
  the consolidated chain and exits `0`. An installer can call it unconditionally.
- **Refuses anything it does not recognise.** Every table, column, type,
  nullability, default, collation and comment is compared against the shipped
  schema first. Any mismatch aborts before a single statement runs, listing what
  differs. A hand-modified schema, or an install that is not this panel, is
  turned away rather than half-upgraded.
- **Resumable rather than transactional.** MySQL and MariaDB do not roll back
  DDL, so this does not pretend to be atomic. Instead every change is
  independent and the plan is recomputed from the live schema on each run, so an
  interrupted upgrade is finished by running it again. Changes are ordered
  cheapest and most reversible first; the two table drops happen last.
- **The bookkeeping rewrite is last and transactional.** If anything fails
  earlier, the install keeps its old migration history and stays re-runnable,
  rather than claiming to be on a chain it is not.
- **Verifies its own work.** After applying, it re-reads the schema and confirms
  it matches the shipped one, and reports a failure if it does not.
- **Never drops a table holding rows.** `subscriptions` and `subscription_items`
  have no code referencing them, so rows there mean something unexpected wrote
  them. If either is non-empty it is kept and reported instead of dropped.

## What it reports but does not change

- **Migration rows matching neither chain.** Rows for migrations that ran on
  this install but ship with no file here — usually leftovers from removed
  features, and extension migrations, which are managed separately. They keep
  their rows.
- **Extra tables.** Anything not in the shipped schema is listed and left alone.
  Tables prefixed `ext_` are ignored entirely; they belong to extensions.
- **Column order.** A column added by a later `ALTER` sits at the end of the
  table, where a fresh install would have it mid-table. Nothing depends on
  column order and fixing it would mean rebuilding the table, so it is reported
  and left. It is the usual reason a `mysqldump` of an upgraded install does not
  match one of a fresh install byte for byte.

## Afterwards

1. `php artisan migrate` should report nothing pending.
2. Do **not** seed — neither `db:seed` nor `migrate --seed`.
3. Check the panel loads and a few servers look right.

The replaced migration rows are written to
`storage/app/migration-history-<timestamp>.json` before they are deleted.

## How it decides what to change

The shipped schema lives at [`database/schema/fresh-schema.sql`](../database/schema/fresh-schema.sql)
— a structure-only dump of a fresh install, regenerated by
[`scripts/schema-diff.sh`](../scripts/schema-diff.sh) whenever the migrations
change. The command parses it and compares it against `information_schema`, so
it is always checking against the same artifact CI checks against, rather than a
separately maintained description that could drift.

Indexes are matched **by shape** — their columns and uniqueness — rather than by
name. An index with the right columns under a historical name is recognised as
needing a rename, not as a missing index plus a stranger. That is what makes the
command safe against installs whose exact upgrade history is unknown: the old
names are discovered, not assumed.

The pre-rebuild chain is listed in
[`database/schema/legacy-migrations.txt`](../database/schema/legacy-migrations.txt),
shipped as a manifest so the "are you fully migrated?" check keeps working once
`database/migrations_legacy/` is deleted.

**That manifest must survive as long as this upgrade path is supported** —
deleting it would break the check that stops a half-migrated install being
adopted. `database/migrations_legacy/` itself is only kept for human reference
and is safe to delete (D7); the manifest exists precisely so that deleting it
costs nothing.

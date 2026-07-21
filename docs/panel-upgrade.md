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

> **This tool is experimental.** It has been verified against clones of a real
> install, including deliberately damaged ones, but it alters the schema of a
> live database. Take a backup first, run it with `--dry-run` to see exactly
> what it will do, and report problems — with the command output and the version
> you upgraded from — to the automated installer repository.

## Why this is needed

The panel replaced its migration history: 327 files became 22
(see [database-rebuild/](database-rebuild/)). The two chains build the **same 80
tables and the same 881 columns**, so no data has to move. What breaks is the
bookkeeping — an existing database's `migrations` table lists 327 filenames that
no longer exist, so Laravel would see 22 unknown migrations as "pending" and try
to create tables that are already there.

`p:migrate:adopt` reconciles that. It:

1. builds anything the shipped schema has and this install does not — missing
   tables, columns, indexes and foreign keys;
2. renames the handful of indexes and foreign keys still carrying names from
   tables that were renamed years ago (`service_options_*` → `eggs_*`, and so
   on);
3. rebuilds one index on `ticket_messages` that the old chain created over the
   wrong columns;
4. drops `subscriptions` and `subscription_items`, which the rebuild removed
   (D2) — **only if they are empty**;
5. rewrites the `migrations` table to list the consolidated chain — but only
   once the schema actually matches.

**No row data is written**, other than the `migrations` table itself, except
where the plan marks a line with `!`. Those flag the two cases that do touch
rows: adding a `NOT NULL` column with no default to a table that already has
rows, and tightening a nullable column that already holds NULLs.

Rows are *read* in two narrow ways, both aggregates: counting them, to know
whether adding a `NOT NULL` column would write to anything, and checking whether
any value falls outside the range of a type it is about to change to. No row is
read out of the database or copied anywhere.

## Requirements and ordering

There is no requirement to be fully migrated on the old chain. The command
works from **what the database actually contains**, not from what its
`migrations` table claims, so an install that stopped part-way along the
development branch is handled the same as one that got all the way: whatever is
missing is compared against the shipped schema and built.

That matters because installs that tracked `develop` are all at slightly
different points — one has eight of the last ten changes, another five, another
all ten. There is no single "behind" state to catch up from, and the new code no
longer ships the old migration files to catch up with. Comparing schemas instead
of migration lists sidesteps the problem entirely.

So the upgrade path is just:

```
php artisan p:migrate:adopt --assume-yes --no-interaction
```

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

Exit code is `0` on success or when there is nothing to do, `1` when anything
was left unresolved — including a partial success, where the fixable changes
were applied but the migration history was not rewritten.

## Safety properties

- **Idempotent.** Running it twice is a no-op — the second run recomputes the
  plan from the live schema, finds nothing to do, and exits `0`. An installer can
  call it unconditionally.
- **Repairs what it can, reports what it cannot.** A difference it cannot fix
  safely does not stop the run. Everything fixable is still applied, and the
  unfixable remainder is listed at the end with the reason. Nothing is
  half-applied silently.
- **Never destroys data to reach the target schema.** Two classes of difference
  are deliberately left alone: a column whose type would have to narrow or
  change family to match (truncation or reinterpretation), and a column this
  install has that the shipped schema does not (dropping it loses whatever is in
  it). Both are reported for the operator to resolve by hand.
- **Resumable rather than transactional.** MySQL and MariaDB do not roll back
  DDL, so this does not pretend to be atomic. Instead every change is
  independent and the plan is recomputed from the live schema as it goes, so an
  interrupted upgrade is finished by running it again. Changes are ordered
  build-first and destructive-last; the two table drops happen last.
- **Recomputes between phases, not just between runs.** Applying one change
  routinely changes what the rest need to do — adding a column makes an index
  over it possible, and on MariaDB rebuilding a foreign key takes its
  identically-named backing index with it. Changes are therefore applied a phase
  at a time against a freshly-read schema, rather than from a plan fixed up
  front.
- **The bookkeeping rewrite is last, transactional, and conditional.** It only
  happens once the schema genuinely matches. If anything is left over, the
  install keeps its old migration history and stays re-runnable rather than
  claiming to be on a chain it is not.
- **Never drops a table holding rows.** `subscriptions` and `subscription_items`
  have no code referencing them, so rows there mean something unexpected wrote
  them. If either is non-empty it is kept and reported instead of dropped.

## What it reports but does not change

- **Migration rows matching neither chain.** Rows for migrations that ran on
  this install but ship with no file here — usually leftovers from removed
  features, and extension migrations, which are managed separately. They keep
  their rows.
- **How far behind the old chain the install is.** Reported as context, since it
  explains why there is work to do, but it is not what the plan is built from.
- **Columns this install has and the shipped schema does not.** Kept, because
  dropping a column destroys whatever is in it.
- **Columns whose type would have to narrow or change family.** Kept, with the
  expected and actual types named, because either change could truncate or
  reinterpret stored values. These block the migration history rewrite until
  resolved by hand.

  Two type differences that *look* like this are corrected anyway, because they
  provably lose nothing. `char(n)` → `varchar(n)` holds the same values either
  way. A change of signedness on an integer column moves the range rather than
  shrinking it, so it is allowed once the column has been checked to contain no
  value outside the target range — and reported, not applied, when it does.
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

Missing tables and columns are rebuilt from that same dump, so a column an
install never got is created with exactly the type, nullability, default,
collation and comment a fresh install would give it, in the same position in the
table.

The pre-rebuild chain is listed in
[`database/schema/legacy-migrations.txt`](../database/schema/legacy-migrations.txt),
shipped as a manifest so the command knows which `migrations` rows belong to the
old chain — those are the ones it replaces — once `database/migrations_legacy/`
is deleted.

**That manifest must survive as long as this upgrade path is supported.**
Without it the command cannot tell an old-chain row from a row belonging to an
extension or a removed feature, and would either strand the old rows or delete
rows it should keep. It is no longer used to gate the upgrade — being behind the
old chain is fine — only to identify what to replace.
`database/migrations_legacy/` itself is only kept for human reference and is safe
to delete (D7); the manifest exists precisely so that deleting it costs nothing.

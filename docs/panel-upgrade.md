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

Migrations added *after* the consolidation (files dated later than
`2026_07_20_000022`) do introduce real schema the legacy chain never had. They
need no special handling here: step 1 below builds whatever the shipped schema
has and the install does not, so the same run that fixes the bookkeeping also
creates those tables and columns. This is why
[`fresh-schema.sql`](../database/schema/fresh-schema.sql) **must be regenerated
whenever a migration is added** — `scripts/schema-diff.sh` fails the build
otherwise, and an out-of-date baseline would leave adopting installs stamped as
migrated without the new schema.

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
5. walks you through any **data decision** the schema cannot make on its own —
   an integer column that this panel reads as text, or a NOT NULL column that
   still holds NULLs — proposing a safe default and applying what you confirm;
6. rewrites the `migrations` table to list the consolidated chain — but only
   once the schema actually matches.

**No row data is written**, other than the `migrations` table itself, except
where the plan marks a line with `!`. Those flag the two cases that do touch
rows: adding a `NOT NULL` column with no default to a table that already has
rows, and tightening a nullable column that already holds NULLs.

Rows are *read* in two narrow ways, both aggregates: counting them, to know
whether adding a `NOT NULL` column would write to anything, and checking whether
any value falls outside the range of a type it is about to change to. No row is
read out of the database or copied anywhere.

The one exception is a **data decision** (see below): where a column's meaning,
not just its shape, has to change, the command reads that column's distinct
values, proposes a mapping, and writes the rows you confirm. This is the only
place it rewrites ordinary table data, and it always shows the exact `UPDATE`
before running it.

## Data decisions

Some differences cannot be closed by DDL alone, because they turn on what the
rows *mean*. Two come up in practice on installs that passed through a fork:

- **An integer column this panel reads as text.** A fork stored `users.state`
  as an enum of integers; this panel uses `NULL` for a normal account,
  `'suspended'`, or `'pending'`. Widening `int` to `varchar` keeps the data but
  not the meaning — only you know which integer stood for "suspended". The
  command shows you the distinct values and how many accounts hold each, and
  asks, per value, what it means. Anything you do not claim becomes a normal
  (NULL) account. Getting this wrong would silently un-suspend or lock out
  users, so it is never guessed.
- **A NOT NULL column that still holds NULLs.** `egg_variables.rules` may be
  NULL on older installs, but the shipped schema requires a value. Tightening it
  as-is lets the database blank every NULL to `''` with no warning — which for a
  rule set silently removes all validation. Instead the command proposes a safe
  fill (`'nullable|string'`, meaning "optional") and lets you change it before
  the column is made NOT NULL.

These run **before** the schema changes, so by the time a column is altered its
rows already fit. Each is applied as a plain `UPDATE` you see first.

Under `--assume-yes`, a decision with a safe default (a NULL fill) is taken
automatically; one that needs a genuine choice (the state remap) is **skipped
and reported**, and holds back the migration-history rewrite so the upgrade is
finished by re-running it interactively. Automation never guesses a mapping it
cannot be sure of.

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
| `--force` | Reconcile the schema again on an install that has already been adopted. |

Exit code is `0` on success or when there is nothing to do, `1` when anything
was left unresolved — including a partial success, where the fixable changes
were applied but the migration history was not rewritten, and an already-adopted
install whose schema has since drifted.

## This is a one-time step

Once the migration history has been rewritten, adoption has happened, and the
install is upgraded like any other from then on:

```bash
php artisan migrate
```

Running `p:migrate:adopt` again says so and stops, without re-presenting the
first-time plan or its prompts:

```
  ✔ Already adopted — this install is on the consolidated migration chain.
    The last adoption run on this machine was 2026-07-23 20:12:00.
    Its schema still matches the shipped one exactly, so there is nothing to do.
```

The test is the `migrations` table itself: an adopted install lists **every**
consolidated migration and **no** rows from the old chain. Both halves matter.
An install that pulled the new files and ran `migrate` before finding this
command has the consolidated rows *and* 327 stale ones — it is not adopted, and
is offered the ordinary upgrade so those rows get cleaned up.

If the schema has drifted since adoption, that is reported as drift and nothing
is written; the fix is `php artisan migrate` first, since a migration added
after adoption usually accounts for it, and `--force` only if the difference
survives that.

## Safety properties

- **Idempotent, and it says so.** Running it twice is not just a harmless no-op
  — the second run recognises the install as already adopted, reports it, and
  exits `0` without rebuilding the first-time plan. An installer can call it
  unconditionally.
- **Repairs what it can, reports what it cannot.** A difference it cannot fix
  safely does not stop the run. Everything fixable is still applied, and the
  unfixable remainder is listed at the end with the reason. Nothing is
  half-applied silently.
- **Never destroys data to reach the target schema.** Where a difference cannot
  be closed without a judgement about the data — an integer column read as text,
  a NOT NULL column holding NULLs — it is turned into a guided **data decision**
  (see above) rather than forced. Where even that is unsafe to automate — a
  column whose type would have to narrow or change family, or a column this
  install has that the shipped schema does not — it is reported for the operator
  to resolve by hand. Nothing is silently coerced or dropped.
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

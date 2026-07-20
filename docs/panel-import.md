# Importing from another panel

`php artisan p:migrate:import` copies an existing Pterodactyl, Jexactyl or
JexPanel installation into a fresh install of this panel. It is aimed at the
automated installer: an operator who has just installed this panel and wants
their old data in it.

This document is the integration contract for the installer. For the reasoning
behind the target schema itself, see [database-rebuild/](database-rebuild/).

> **This tool is experimental.** It is new and lightly tested against real
> installations. It can fail to migrate some data correctly. Every run should be
> preceded by a database backup, and the operator should be told to report
> problems — with the command output and their source panel version — to the
> automated installer repository.

## Supported sources

| `--from` | Panel | Version the profile was built against |
|---|---|---|
| `pterodactyl` | Pterodactyl | 1.11.x |
| `jexactyl` | Jexactyl | 3.x |
| `jexpanel` | JexPanel | 4.x |

Each profile is pinned to one upstream version. Mapping every historical schema
variant of three forks is not tractable; **the operator must update their old
panel to its final release before importing.** The importer refuses to run
rather than guess when it meets a schema it does not recognise, so an
out-of-date source fails loudly instead of importing partial rows.

Upgrading an *existing* install of this panel is a different problem and is not
what this command does — use `p:migrate:adopt`, see
[panel-upgrade.md](panel-upgrade.md).

## What it does

- Copies users, API keys, SSH keys, nests, eggs, nodes, allocations, servers,
  subusers, databases, backups, schedules, tasks and mounts.
- **Preserves IDs and UUIDs.** Wings identifies servers by UUID and stores their
  data directories under it, so renumbering would orphan every server on disk.
- **Re-encrypts secrets.** Node daemon tokens, database and database-host
  passwords, TOTP secrets and API key tokens are encrypted with the source
  panel's `APP_KEY`. They are decrypted with the old key and re-encrypted with
  this panel's, which is why `SOURCE_APP_KEY` is required.
- Password hashes are bcrypt and carry over untouched — users keep their
  passwords.
- Reports every column and table it could not carry over, with row counts, so
  "nothing was lost" is never assumed.

The source database is only ever read from. It is never written to.

## Requirements and ordering

The import preserves IDs, so **the target tables must be empty**. The command
checks this and refuses otherwise. The order in the installer is:

```
php artisan migrate --force          # create the schema
php artisan p:migrate:import ...     # import
```

**Do not run `php artisan db:seed` after an import.** Its egg seeder updates eggs
by UUID and would overwrite imported egg definitions with the shipped ones. The
import command seeds the tables this panel has and the source does not (email
notification settings, invoice settings, theme presets) by itself.

If the installer normally runs `db:seed`, it must skip it on the import path.

## Invocation

Interactive (what an operator running it by hand gets):

```bash
php artisan p:migrate:import
```

It prompts for the source panel, database details, password and `APP_KEY`,
prints what will and will not be imported, and asks for confirmation twice —
once to confirm a backup exists, once to start.

Unattended (what the installer should use):

```bash
export SOURCE_DB_PASSWORD='...'      # source database password
export SOURCE_APP_KEY='base64:...'   # APP_KEY from the source panel's .env

php artisan p:migrate:import \
    --from=pterodactyl \
    --host=127.0.0.1 \
    --port=3306 \
    --database=panel \
    --username=pterodactyl \
    --assume-yes \
    --no-interaction
```

### Passing secrets

`SOURCE_DB_PASSWORD` and `SOURCE_APP_KEY` are read from the environment in
preference to the command line. **Prefer the environment variables.** Anything
passed as `--password` or `--source-key` is visible to every user on the box in
`ps` output and lands in shell history; the command warns when it sees them.

The installer should export them for the single command and unset them after,
and must not write them to a log file.

### Options

| Option | Effect |
|---|---|
| `--from=` | Source panel. Required (prompted when interactive). |
| `--host=`, `--port=`, `--database=`, `--username=` | Source database connection. |
| `--dry-run` | Runs the entire import inside a transaction and rolls it back. Reports exactly what would happen, including constraint failures. Writes nothing. |
| `--with-logs` | Also import activity, audit, API and task logs. Off by default because they are bulky and rarely needed. |
| `--with-billing` | JexPanel only. Also import products, categories, orders, server groups, presets, tickets and theme. |
| `--assume-yes` | Answer the confirmation prompts yes. **Required for unattended runs** — the command refuses to import non-interactively without it. |

Exit code is `0` on success, `1` on any refusal or failure.

## Safety properties

Worth stating explicitly, since the installer is committing users to this:

- **All-or-nothing.** The whole import runs in one transaction. Any failure
  rolls back and the database is left as it was. The command says so in its
  error output.
- **Fails before writing, not during.** A pre-flight pass checks that the target
  tables are empty, that the target schema exists, and that the source
  `APP_KEY` actually decrypts the source panel's secrets. A wrong key is caught
  here, not halfway through.
- **Refuses on unknown schemas.** If a target column is `NOT NULL`, has no
  database default, and neither the source nor the profile supplies a value, the
  import stops and names the column. This is the signal that the source panel is
  on a version the profile was not built against.
- **Verifies its own output.** Foreign key checks are suspended during the copy
  (`servers.allocation_id` and `allocations.server_id` reference each other, so
  no insertion order satisfies both). Before committing, every foreign key on
  every imported table is checked for orphans, and the import is rolled back if
  any are found.
- **`--dry-run` is a real run.** It exercises the same inserts and the same
  constraints, then rolls back — it is not a simulation that can disagree with
  the real thing.

## What is not imported

Common to every source:

- **Panel settings** — keyed differently, and their secrets are encrypted with
  the old `APP_KEY`. Mail, billing and branding must be configured again.
- Sessions, queued jobs, delivered notifications and pending password resets —
  all invalidated by the move.

Per source, the notable losses (the command prints the full list with row counts
before asking for confirmation):

- **Pterodactyl / Jexactyl:** user first and last names (this panel identifies
  users by username), and node locations (this panel has no locations concept —
  tell operators to note their grouping first).
- **Jexactyl:** store credits and store-purchased resources. This panel bills
  through products and orders and there is no honest conversion from a credit
  balance. Also support tickets, coupons and theme settings.
- **JexPanel:** recurring subscriptions, which this panel dropped in favour of
  billing products. Servers that were paid for by a subscription import without
  a billing plan attached and need review. Also discount codes, which should be
  recreated as coupons.

## After importing

The command prints these, and the installer should surface them too:

1. Do **not** run `db:seed`.
2. Configure this panel's settings — they are not imported.
3. Node tokens were re-encrypted for this panel, so every node needs its
   configuration regenerated and its Wings pointed here and restarted:
   `php artisan p:node:configuration`
4. Check a few servers in the UI before letting users back in.

## Extending it

Profiles live in `app/Services/Migration/Profiles/`. The importer is
schema-driven: it copies the intersection of the source and target columns, so a
profile only declares what cannot be inferred — renames, columns that are
dropped or converted, computed values, and defaults. `PterodactylProfile` holds
the shared core; the two forks extend it and replace the tables they changed.

To add a panel, subclass `ImportProfile` (or `PterodactylProfile` for a
Pterodactyl derivative) and register it in `ImportPanelCommand::resolveProfile()`.

Verifying a profile against a real schema is the same method used to build these
three: replay the source panel's migration chain into a scratch database, then
compare its columns against this panel's.

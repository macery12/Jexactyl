# M12 Labs — V2 UI, Extension System and Database Rebuild

> **Commits:** 53 | **Files Changed:** 1,810 | **Additions:** 93,736 | **Deletions:** 14,368

---

## Upgrade Path

**A fresh install is the recommended path onto this release.** 3.0 alpha carries
a large number of breaking changes — the migration chain is replaced, the V1
frontend is gone from the site root, and settings rows that used to be created by
migrations are now seeded. Standing up a clean install and importing data is
less work than reconciling an old one.

**Fresh install** — unchanged from every previous release:

```bash
php artisan migrate --seed --force
```

Migrations are structure-only, as before. What moved in this release is *which*
default rows the seeders create: email notification settings, invoice settings
and theme presets used to be written by migrations and are now seeded alongside
the rest.

**Upgrading an existing install** is supported but is the fallback, not the
recommendation:

```bash
php artisan p:migrate:adopt
```

This assumes the install is already fully migrated on the old chain — which it
will be, for anyone running the last release. That matters because this release
no longer ships the old migration files, so an install that is *behind* cannot
catch up once this code is deployed. `p:migrate:adopt` checks for exactly this
and refuses, naming the oldest missing migration, rather than upgrading a
half-migrated database. It is idempotent, so an installer may call it
unconditionally.

Do **not** seed after an adopt or an import — neither `--seed` nor `db:seed`.
The egg seeder updates eggs by UUID and would overwrite customised or imported
egg definitions.

Full details: [`docs/panel-upgrade.md`](docs/panel-upgrade.md).

---

## Major Changes

---

### V2 User Interface

The V1 React SPA has been replaced by a complete frontend rewrite living in
`frontend/`. This is the largest single change in the release: 435 source files
covering 75 pages across authentication, account management, the server view and
the entire admin surface — overview, users, roles, nodes, nests, databases,
activity, webhooks, alerts, features, billing, email templates, marketplace,
custom domains and AI.

**The cutover ran in three recorded phases:**

1. `ui/` was renamed to `frontend/` and the extension installer retargeted
2. V2 took the site root, retiring the `/v2` prefix
3. V1 was archived under `archive/` — no longer built, routed, linted or autoloaded

Anything pointing at a `/v2/...` URL needs updating; the prefix is retired with
no redirects. All URLs now derive from a single `BASE` constant in
`frontend/src/lib/base.ts`.

**Internationalisation moved from i18next to Paraglide/inlang.** Messages live in
a flat namespaced map of 3,587 ids. The build fails on a missing key rather than
shipping one, so a broken translation cannot reach production. English and
Russian ship in this release.

**Theming is driven entirely by CSS variables** — no hardcoded colours anywhere in
the UI. The dark palettes use a tuned contrast ladder so each surface layer steps
visibly from the one beneath it.

**A new Features module** at `/admin/features` centralises per-module on/off
toggles. Disabled features disappear from navigation and are blocked on direct
access, replacing the older "panel mode" setting.

Cutover records: [`docs/v1-cutover/`](docs/v1-cutover/).

---

### Extension System

Extensions have been promoted from a plugin drop-in to a first-class subsystem
with its own admin surface, database ownership, localisation and security model.

**What extensions can now do:**

| Area | Capability |
|---|---|
| **Admin UI** | Register their own admin pages and admin API routes, rendered inside the panel's own navigation |
| **Database** | Own and version their own migrations, retaining data by default with an audited `--drop-data` path for deliberate teardown |
| **Localisation** | Ship `messages/<locale>.json` fragments, namespaced `ext.<id>.`, merged into a second Paraglide path at build time with no allowlist change needed |
| **Scheduling** | Register scheduled tasks through the panel scheduler |
| **Frontend** | Ship components whose classes are scanned into the Tailwind build |

**Security and compatibility hardening:**

- `compatiblePanelVersions` accepts a semver range, so an extension declares the
  panel versions it supports rather than a single pinned one
- A runtime route guard audits what an extension actually registered against
  what it declared
- Admin API calls are throttled per extension (60/min on the `api.ext-admin`
  limiter) so one extension cannot exhaust the budget for others
- The repository scanner rejects packages containing `FormRequest` classes or
  closure-based routes before they can be installed

Eight console commands cover install, update and uninstall, including
easy-install flows. Architecture notes:
[`docs/extensions/architecture.md`](docs/extensions/architecture.md).

---

### Database Rebuild

The migration chain has been consolidated from **327 files into 22
domain-grouped files** covering 80 tables. Both chains build the same tables and
the same 881 columns.

**How the rebuild was validated:** rather than inferring intent from ten years of
migration files, the full historical chain was replayed into a scratch database
and the resulting schema dumped. That dump — `database/schema/fresh-schema.sql` —
is now the committed baseline, and `scripts/schema-diff.sh` checks the migrations
against it on demand, so upstream drift shows up as a diff rather than as a
surprise in production.

**Two behavioural changes came out of it:**

- `subscriptions` and `subscription_items` are dropped. Both were Cashier-style
  leftovers with zero code referencing them.
- Default settings rows moved out of migrations and into three idempotent
  seeders. `migrate --seed` was already the fresh-install command, so this
  changes nothing operationally — it just puts the default rows where the rest
  of the defaults already live.

The old chain is retained under `database/migrations_legacy/` for reference;
Laravel does not load it. Full reasoning and decision log:
[`docs/database-rebuild/`](docs/database-rebuild/).

---

### Migration Tooling (untested — may not work as expected)

Two console commands were added to move installations onto this release. **Both
are experimental and have not been tested against real installations.** They pass
their own test suites against scratch databases, which is not the same thing as
working on somebody's live panel. Treat a first run as something that may fail:
take a backup, run `--dry-run`, and read what it says it is about to do before
letting it do it. This is also why a fresh install is the recommended path onto
this release rather than either of these commands.

**`p:migrate:import`** brings a **Pterodactyl 1.11, Jexactyl 3 or JexPanel 4**
install into a fresh install of this panel. It re-encrypts node tokens, TOTP
secrets, API keys and database passwords from the source `APP_KEY` to the
destination one, and preserves IDs and UUIDs — Wings keys server directories by
UUID, so changing them would orphan every server on disk.

**`p:migrate:adopt`** upgrades an existing install of this panel onto the
consolidated chain. Because both chains produce an identical schema, it moves no
data: it rewrites the migration bookkeeping and aligns thirteen index and
constraint names that still carry table names renamed years ago. Indexes are
matched by shape — their columns and uniqueness — rather than by name, so an
index sitting under a historical name is recognised as needing a rename instead
of being mistaken for a missing index plus a stranger. That is what makes it safe
against installs whose exact upgrade history is unknown.

Both commands refuse rather than guess. The importer aborts naming any target
column it cannot satisfy; the adopter compares every table, column, type,
nullability, default, collation and comment against the shipped schema and aborts
before running a single statement if anything does not match. Both support
`--dry-run`, both require `--assume-yes` to run unattended, and both print what
they cannot carry over before asking for confirmation.

Documentation: [`docs/panel-import.md`](docs/panel-import.md) and
[`docs/panel-upgrade.md`](docs/panel-upgrade.md).

---

## Fixes & Improvements

### Backend
- New public storefront catalog endpoint, unauthenticated and rate-limited, backed by slim transformers
- AI module overhaul with response caching and a model keep-warm command
- Landing page section builder with an admin editor at `/admin/landing`

### Frontend
- CI now builds, typechecks and lints the V2 UI
- Admin activity page handles its disabled state correctly
- Registry dead-code cleanup

---

## Verification

- **287 unit tests pass**; the frontend builds clean under `pnpm run build`
- **Migration chain** — all 22 files apply clean, `db:seed` is clean and idempotent under a double run, a full `migrate:rollback` is clean, and a name-agnostic structural diff against the pre-rebuild ground truth shows only the three whitelisted deltas
- **`p:migrate:adopt`** — an adopted clone of a real database and a genuinely fresh `migrate` agree on 1,244 schema facts with zero differences; only the `migrations` table changed rows. Refusals were confirmed for a behind-chain install, a hand-modified schema, an empty database, an unattended run without `--assume-yes`, and a non-empty vestigial table
- **`p:migrate:import`** — 18 of 18 data checks across all three source panels, covering encryption re-wrap, the `oom_disabled` to `oom_killer` polarity inversion, port renames and UUID/ID/FK preservation. A negative test injecting one orphaned row aborted the run with nothing written


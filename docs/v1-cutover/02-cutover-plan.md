# V1 → V2 Cutover Plan

> **✅ EXECUTED 2026-07-16** — all phases landed as sequential commits on `overhaul/frontend`.
> Deviations from this plan (user decisions at execution): V1 was **archived to `archive/`
> instead of deleted**, with **no bake period**; and **`/v2/*` got no redirects** (the mount
> was removed outright). See [README](./README.md) for the executed summary.
>
> Sequenced so that each phase is independently shippable and independently revertable.
> Prerequisites live in [01 — Audit findings](./01-audit-findings.md).

## Principles

1. **Fix blockers before moving anything.** The rename and the root swap both make the
   blockers in [01](./01-audit-findings.md) harder to see, not easier.
2. **One irreversible act per phase.** Rename, swap, and delete are three commits, not one.
3. **Delete V1 last.** It is the rollback plan until it isn't there.

---

## Phase 0 — Prerequisites (before anything moves)

These are ordinary code changes, no restructuring. All of them are cheaper now than after the swap.

| # | Task | From |
|---|---|---|
| ~~0.1~~ | ~~Decide **Links**: port to V2, or drop + delete backend~~ — ✅ **done 2026-07-15: ported** (admin editor + user sidebar surface; backend kept as-is) | [01 §1](./01-audit-findings.md#1-the-admin-links-module-is-missing-from-v2) ✅ |
| 0.2 | Honour `permission` in `resolveElement` | [01 §2](./01-audit-findings.md#2-v2-lost-client-side-route-permission-enforcement) 🔴 |
| 0.3 | Restore the 7 dropped `permission` gates | [01 §3](./01-audit-findings.md#3-seven-routes-silently-dropped-their-permission-gate) 🔴 |
| 0.4 | Give V2 a CI job (build + typecheck + lint) | [01 §4](./01-audit-findings.md#4-v2-has-no-ci-coverage) 🔴 |
| ~~0.5~~ | ~~Decide **palworld_server_manager**: port the page, or delete the PHP package~~ — **withdrawn 2026-07-16: the premise was wrong.** No page needs porting and no PHP package needs deleting; packages are gitignored install output from the extensions repo, not source. The real work is retargeting the installer, which lands in **Phase 1** (the V2 path isn't stable until the rename). Nothing to do in Phase 0. | [01 §5](./01-audit-findings.md#5-the-extension-installer-only-knows-v1s-frontend-path) → [Phase 1](#phase-1--rename-ui--frontend) |
| 0.6 | Make PayPal `cancel_url` overridable; pass V2 URLs | [01 §6](./01-audit-findings.md#6-paypal-cancel-strands-v2-users-in-v1) 🟠 |
| 0.7 | **Replace the 170 hardcoded `/v2` strings with a derived basename** | [01 improvements](./01-audit-findings.md#improvements-worth-doing-not-blockers) |

> **0.7 is the one that decides how bad Phase 2 is.** With a single `BASE` constant (or a
> React Router `basename`), the root swap is a config change. Without it, it's a sed across
> 85 files landing in the same commit as the swap itself — which is exactly the commit you
> want to be able to read and revert cleanly.

**Exit:** V2 builds green in CI, enforces permissions, has no known parity gaps, and its base
path is configurable.

---

## Phase 1 — Rename `ui/` → `frontend/`

Pure move. No behaviour change, no URL change; V2 still serves at `/v2`. Ship it alone.

```
git mv ui frontend
```

### Every reference that must move with it

The blast radius is genuinely small — `ui/` is self-contained and nothing in `app/` or
`routes/` refers to it by path:

| File | Line | Current | Notes |
|---|---|---|---|
| `.gitignore` | 52 | `/ui/dist` | → `/frontend/dist` |
| `crowdin.yml` | 22-23 | `/ui/messages/en.json`, `/ui/messages/%locale%.json` | → `frontend/...`. **Coordinate with Crowdin** — the source path changes on their side too. |
| `crowdin.yml` | 1-6, 25 | comments referencing `ui/messages`, `ui/project.inlang` | |
| `.claude/skills/v2page/SKILL.md` | — | drives page work out of `ui/` | Skill breaks silently otherwise |
| `docs/V2.md` | many | `../frontend/src/...` links | |
| `docs/V2_UI_Structure.md` | — | `ui/` paths | |
| `docs/Phase_1_Rewrite.md` | — | `ui/` paths | |

### What does **not** change

- `frontend/vite.config.ts:40-42` — `publicDirectory: '../public'`, `buildDirectory: 'build-v2'`,
  `hotFile: '../public/hot-v2'` are all relative or output-named. They keep working. Renaming
  `build-v2`/`hot-v2` is a **Phase 3** concern; leave them alone here.
- `resources/views/templates/v2/core.blade.php` — references the Vite build, not the source dir.
- `routes/v2.php`, `RouteServiceProvider.php:43` — URL-space, not filesystem.

### Do it as part of this phase

Add a root `pnpm-workspace.yaml` including `frontend`, so one `pnpm install` covers both trees
while V1 still exists (and satisfies 0.4 cleanly).

**Retarget the extension installer** ([01 §5](./01-audit-findings.md#5-the-extension-installer-only-knows-v1s-frontend-path)).
This phase is what makes the V2 install path stable, so it belongs here — doing it earlier means
editing the same line twice:

| File | Line | Current | → |
|---|---|---|---|
| `app/Services/Extensions/ExtensionPackageArtifactService.php` | 284 | `resources/scripts/extensions/packages/%s/` | `frontend/src/extensions/packages/%s/` |
| `.gitignore` | 28-29 | `app/Extensions/Packages/`, `resources/scripts/extensions/packages/` | **add** `frontend/src/extensions/packages/` — install output, never tracked source |

This is the one part of Phase 1 that is *not* a pure move: it changes where a real install writes.
Keep `resources/scripts/extensions/packages/` ignored too until Phase 3 deletes V1.

Packaging itself is **extensions-repo work, not panel work** — each package's frontend is V1-shaped
(i18next, V1 imports) and V2 needs Paraglide + theme vars. Nothing blocks Phase 1 on it; the panel
side is done once the path is retargeted.

**Verify:** `cd frontend && pnpm install && pnpm build`; `/v2` loads; hot reload works;
`grep -rn "\bui/" --exclude-dir=node_modules .` returns only intentional hits.

---

## Phase 2 — V2 takes the root

The irreversible one. Ship behind the ability to revert a single commit.

### Server-side

1. In `RouteServiceProvider.php`, mount the V2 shell at `/` **after** the `/v2` group (keep
   `/v2` alive during the bake — it 301s in Phase 3, not here).
2. Retire `routes/base.php`'s V1 catch-all and point `/`, `/account`, `/{react}` at the V2 shell.
3. `routes/admin.php` → V2 shell. **Decide [01 §7](./01-audit-findings.md#7-the-v2-shell-has-no-server-side-auth-middleware) here:**
   V1's `/admin` carried `AdminAuthenticate` + `RequireTwoFactorAuthentication`. Either keep
   them on the admin URL space, or accept SPA-only guarding — but decide it, don't inherit it.
4. `routes/auth.php` (`guest` middleware) → V2 auth shell.
5. `LandingConfigService.php:93` — default CTA `'/v2/auth/login'` → `/auth/login`.

### Client-side

Flip the Phase 0.7 basename from `/v2` to `/`. If 0.7 was skipped, this is where the 85-file
sed lands, and this commit stops being reviewable.

Also: `App.tsx:55` sends authenticated users to `/v2/account`, and V2's **dashboard is the
index of the account area** (`account.routes.ts:22`) while V1's dashboard was at `/`. So the
account area should mount at `/` at swap time — dashboard `/`, account settings `/settings` —
rather than keeping a `/account` prefix. This is a real structural change, not a find-replace.

### URL redirect map

V1 URL → V2 destination. Note the `/account` inversion: V1's `/account` was the *account
overview*; V2's account area root is the *dashboard*.

| V1 URL | V2 destination | Why |
|---|---|---|
| `/` | `/` (dashboard) | Same |
| `/account` | `/settings` | V1 account overview → V2 Account settings; `/` is now the dashboard |
| `/account/security` | `/settings` (Devices tab) | Merged — V2.md ➖ |
| `/account/credentials` | `/credentials` | |
| `/account/activity` | `/activity` | |
| `/account/billing/order/:id` | `/billing/orders` (inspector modal) | Merged — V2.md ➖ |
| `/account/billing/cancel` | `/billing/cancel` | See [01 §6](./01-audit-findings.md#6-paypal-cancel-strands-v2-users-in-v1) — **live PayPal redirect target, must not 404** |
| `/server/:id/*` | `/server/:id/*` | Same shape |
| `/admin/nodes/*`, `/admin/servers/*` | `/admin/infrastructure` | Merged; V2 already redirects (`admin.routes.ts:81-82`) |
| `/admin/plugins/*`, `/admin/mods/*` | `/admin/marketplace` | Aliases dropped — [01 §10](./01-audit-findings.md#10-v1-only-routes-with-no-v2-equivalent) |
| `/admin/links/*` | `/admin/links` | Ported 2026-07-15 — same shape ([01 §1](./01-audit-findings.md#1-the-admin-links-module-is-missing-from-v2)) |
| `/admin/databases/:id` | `/admin/databases` (master–detail) | Merged |
| `/admin/*` (rest) | `/admin/*` | Same shape |

**Verify:** every row above, as **owner, permission-limited admin, and subuser** — the last one
matters most, given [01 §2](./01-audit-findings.md#2-v2-lost-client-side-route-permission-enforcement)
and the `can()` wildcard fix flagged in V2.md's punch list.

### Bake

Leave V1 code in place, unrouted, for at least one release. It is the rollback: re-point the
route groups and V1 is back.

---

## Phase 3 — Delete V1

Only after Phase 2 has baked. Full kill list, including what must **not** be deleted:
[03 — Decommission inventory](./03-decommission-inventory.md).

Summary: `resources/scripts` (813 files, 6.5M), V1 Blade templates, V1 root build scripts and
Vite config, the `/overview/version` + `/overview/metrics` endpoints, and — depending on 0.1
and 0.5 — the Links and palworld backends.

Then: `/v2/*` → 301 to root, and rename `build-v2`/`hot-v2` → `build`/`hot` once V1's `public/build`
is gone.

---

## Phase ordering, in one line

```
0. Fix blockers  →  1. git mv ui frontend  →  2. Root swap (+ bake)  →  3. Delete V1
   (reversible)     (reversible)              (revert = 1 commit)       (irreversible)
```

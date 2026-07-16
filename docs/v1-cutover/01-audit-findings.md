# V2 Audit — Findings

> Audited 2026-07-15 against `overhaul/frontend` @ `1abfdf5a8`.
> Method: V1 route registries (`resources/scripts/routers/routes/*.ts`) and routers diffed
> against V2 registries (`frontend/src/routes/*.routes.ts`) and the V2 resolver (`frontend/src/app/App.tsx`),
> plus backend route/controller tracing and an orphan-file sweep of `frontend/src`.

Findings are ordered by whether they block cutover. Severity is about **cutover risk**, not
about how hard they are to fix — several blockers are one-liners.

---

## Summary

| # | Finding | Blocks cutover? |
|---|---|---|
| [1](#1-the-admin-links-module-is-missing-from-v2) | ~~Admin **Links** module missing from V2 entirely (and from the scoreboard)~~ — ✅ **resolved 2026-07-15: ported** | ✅ Was 🔴 |
| [2](#2-v2-lost-client-side-route-permission-enforcement) | ~~V2 lost client-side route **permission enforcement**~~ — ✅ **resolved 2026-07-15** | ✅ Was 🔴 |
| [3](#3-eleven-routes-silently-dropped-or-widened-their-permission-gate) | ~~**11** routes dropped or widened their `permission` gate vs V1 (was "7" — recount below)~~ — ✅ **resolved 2026-07-15** | ✅ Was 🔴 |
| [11](#11-the-admin-held-permission-set-is-a-phase-1-stub-every-admin-gets-) | ~~Admin held-permission set is a **stub** — every admin gets `*`~~ — ✅ **resolved 2026-07-15** | ✅ Was 🔴 |
| [4](#4-v2-has-no-ci-coverage) | V2 is **never built, linted or type-checked in CI** | 🔴 Yes |
| [5](#5-the-extension-installer-only-knows-v1s-frontend-path) | Extension **installer** hardcodes V1's frontend path; needs retargeting to `frontend/` after Phase 1 | 🔴 Yes |
| [6](#6-paypal-cancel-strands-v2-users-in-v1) | PayPal **cancel** URL hardcoded to V1 — strands V2 users, 404s after deletion | 🟠 Bug today |
| [7](#7-the-v2-shell-has-no-server-side-auth-middleware) | V2 shell has **no server-side auth middleware** (V1's `/admin` had three) | 🟠 At root swap |
| [8](#8-admin-activity-lost-its-feature-condition) | Admin Activity lost its `activityEnabled` condition | 🟡 Verify |
| [9](#9-dead-code-in-v2) | Dead code in V2 (`Placeholder`, unread `placeholder` flag, stale doc link) | 🟢 Cleanup |
| [10](#10-v1-only-routes-with-no-v2-equivalent) | V1-only alias routes (`plugins/*`, `mods/*`) with no V2 equivalent | 🟢 Redirects |

---

## 1. The admin Links module is missing from V2

> ✅ **RESOLVED 2026-07-15 — ported, not dropped.** The decision below went to *port*. V2 now has
> [`pages/admin/links/LinksSection.tsx`](../../frontend/src/pages/admin/links/LinksSection.tsx) +
> `LinkEditor.tsx` (master–detail: search, create, edit, visibility, delete) at
> `/v2/admin/links` (`modules` category, `permission: 'links.read'`, no feature flag — the
> per-link `visible` column is the off switch), **and** the end-user surface at
> [`components/shell/CustomLinks.tsx`](../../frontend/src/components/shell/CustomLinks.tsx), rendered
> through a new `sidebarFooter` slot on `AppShell`/`Sidebar` and passed only by
> `DashboardLayout` — matching V1, where links lived in `DashboardRouter`'s sidebar and not the
> admin/server chrome. API clients: `api/adminLinks.ts` + `api/links.ts`. **No backend changes.**
> **Nothing in §4 of [03](./03-decommission-inventory.md) needs deleting — the backend stays.**
>
> One wrinkle worth remembering: the two endpoints are typed separately on purpose. The client
> transformer omits `visible` (`Api/Client/LinkTransformer` returns id/name/url only, since the
> endpoint pre-filters), so reusing the admin mapper would have typed `visible` as `boolean`
> while it was `undefined` at runtime. Verified against a live round-trip.
>
> The rest of this section is kept as the original finding — it is the record of *why* a
> page-parity scoreboard missed an entire module.

**This is the "did we miss anything?" answer: yes, one whole module.**

V1 has a Custom Links feature — *"Create custom links to external sites for clients."*
It is **not** in any V2 registry, has **no** V2 API client, and does **not** appear anywhere
on the [`V2.md`](../V2.md) scoreboard — so it was never tracked as outstanding.

What exists in V1 and has no V2 counterpart:

| Layer | V1 | V2 |
|---|---|---|
| Admin route | `admin.ts:180` → `links/*`, `permission: 'links.read'`, category `appearance` | — |
| Admin UI | `components/admin/modules/links/` — `LinksContainer`, `LinksTable`, `CreateLinkDialog`, `DeleteLinkDialog` | — |
| API client | `api/getLinks.ts`, `api/routes/admin/links.ts` | — |
| **End-user surface** | `routers/DashboardRouter.tsx:55` — `getLinks()` renders custom links in the user nav | — |

The backend is **live and untouched**:
- `routes/api-application.php:419` → `/api/application/links` full CRUD (`LinkController`)
- `routes/api-client.php:25` → `GET /api/client/links` (`Api/Client/LinkController`)
- Plus `Link` model wiring in `AppServiceProvider`, and both transformers.

Note this is **not admin-only**. The client endpoint exists because V1 renders these links in
the *end-user* sidebar. Cutting over as-is silently removes an operator-configured, user-facing
navigation feature — and operators who configured links get no warning; the rows just stop rendering.

**Decide:** port it (admin editor + user nav surface), or consciously drop it and delete the
backend + `links.read` permission + the `links` table. Do not cut over with the backend live
and no UI — that's an orphaned feature nobody can administer.

---

## 2. V2 lost client-side route permission enforcement

> ✅ **RESOLVED 2026-07-15**, together with #11 and #3 — they only work as a set.
> [`App.tsx`](../../frontend/src/app/App.tsx)'s `resolveElement` now honours `permission` the way it
> already honoured `condition`, dispatching on a new `Area` threaded down from each mount
> (`childRoutes(defs, area)`), because admin and server check against different held sets and
> account/auth are never gated:
>
> - **admin** → [`RequireAdminPermission`](../../frontend/src/components/permissions/RequireAdminPermission.tsx)
>   (new, ported from V1's element of the same name) — spinner while the set loads, then
>   [`AccessDenied`](../../frontend/src/pages/_shared/AccessDenied.tsx) (new; `FeatureDisabled`'s
>   sibling, showing the required permission string like V1 did).
> - **server** → `ServerPermissionGate`, checking `server.permissions`, which `ServerLayout` has
>   already resolved before rendering the subtree — so there is no loading state to wait on.
> - **account/auth** → `area: 'open'`, no gate. Not an oversight: see the structural argument
>   in [#3](#3-eleven-routes-silently-dropped-or-widened-their-permission-gate).
>
> Gate order is `FeatureGate` **outside** the permission gate, mirroring V1 (which filtered by
> `condition` before wrapping in a guard): a module switched off reads as "disabled" to
> everyone, rather than telling an under-privileged user they lack a permission that wouldn't
> help them anyway.
>
> The two gates deliberately have **opposite defaults**, which is the subtlety to preserve if
> this is ever refactored: `FeatureGate` fails **open** on unloaded flags (unknown flag ≈
> "probably on"), `RequireAdminPermission` fails **closed** (unknown permission = "not yet
> proven"). That is why its loading state is not optional — without it, a legitimate admin gets
> a flash of "Access Denied" on first paint.
>
> The rest of this section is kept as the original finding.

V1 guards **route access**. V2 only guards **nav visibility**.

V1 wraps each route's element in a permission guard:

```tsx
// resources/scripts/routers/AdminRouter.tsx:149
{permission ? (
    <RequireAdminPermission permission={permission}>
        <Component />
    </RequireAdminPermission>
) : (
    <Component />
)}
```

…and the same for servers via `PermissionRoute` (`ServerRouter.tsx:64`).

V2's resolver enforces the feature-flag `condition` but **never reads `permission`**:

```tsx
// frontend/src/app/App.tsx:34-38
function resolveElement(r: RouteDef): ReactElement {
    const el = r.element ? createElement(r.element) : <Placeholder title={r.name ?? r.path} />;
    if (r.condition) return <FeatureGate def={r}>{el}</FeatureGate>;   // ← condition only
    return el;
}
```

`RouteDef.permission` is consumed in exactly one place — `frontend/src/routes/nav.ts:37`, which
filters the sidebar. So in V2, **typing any admin URL renders that page** regardless of the
role's permissions.

**Scope it honestly:** the API still enforces, so this is not a data-disclosure hole — the page
shell renders and its requests 403. The real cost is (a) a broken, confusing UI for
under-privileged staff instead of a clean "no access" screen, and (b) any data a page derives
from already-loaded bootstrap state rather than a fresh API call renders without a check. It is
a genuine V1→V2 regression, and the fix is small: honour `permission` in `resolveElement` the
way `condition` already is.

> ⚠️ **Correction (full audit, 2026-07-15).** Two claims above are too generous, and the
> "the fix is small" conclusion does not survive the recount:
>
> 1. **"V2 only guards nav visibility" overstates what the nav does.** `buildNav` *does* call
>    `can(held, r.permission)` — but in the admin area `held` is always `['*']` (see
>    [#11](#11-the-admin-held-permission-set-is-a-phase-1-stub-every-admin-gets-)). The filter
>    is dead code there: **the admin sidebar is not permission-filtered either.** V2 currently
>    guards admin route access *and* admin nav visibility exactly zero times.
> 2. **Honouring `permission` in `resolveElement` fixes nothing on its own for admin.** The
>    resolver would call `can(['*'], …)` → always `true`. #2 and #11 must land **together**;
>    shipping #2 alone produces a green diff with no behaviour change and a false sense that
>    the regression is closed. The server area is the exception — its `held` is real
>    (`server.permissions` from the API), so #2's fix does bite there immediately.

---

## 3. Eleven routes silently dropped or widened their `permission` gate

> ✅ **RESOLVED 2026-07-15 — all 11 closed.** Gaps 1–7 were one-line additions to the two
> registries ([`server.routes.ts`](../../frontend/src/routes/server.routes.ts),
> [`admin.routes.ts`](../../frontend/src/routes/admin.routes.ts)). Gaps 8–11 could **not** be fixed in
> the registry, which is flat and one-entry-per-section — the V1 routes they correspond to live
> *inside* a V2 splat:
>
> - **10–11 (`eggs.read`)** — restored in [`NestsSection`](../../frontend/src/pages/admin/nests/NestsSection.tsx),
>   which wraps its two egg-editor routes in `RequireAdminPermission`. `nests/*` keeps its
>   `nests.read` gate; the editor now needs `eggs.read` on top, as in V1.
> - **8–9 (`server-presets.read`)** — V2 has no presets *route* at all: `PresetManager` was
>   folded into [`CreateServerModal`](../../frontend/src/pages/admin/infrastructure/CreateServerModal.tsx)
>   as an inline editor. The gate went on the "Manage presets" toggle. **Selecting** a preset
>   stays ungated — that's part of creating a server (`servers.create`), not administering the
>   preset library, which is the line V1 drew with a separate route.
>
> Verified by replaying the decision table through the real `can()` (17/17 correct), including
> the two widenings: `nests.read` alone no longer opens the egg editor, and `servers.read` alone
> no longer opens preset CRUD.
>
> **Left as-is deliberately:** V2's hidden `nodes/*` and `servers/*` entries carry no permission.
> They render only `<Navigate>` ([`InfraRedirect`](../../frontend/src/pages/admin/infrastructure/InfraRedirect.tsx))
> and land on `infrastructure/*`, which *is* gated — so there is no ungated surface to reach.
> The Infrastructure OR-widening below is still an open **product decision**, not a defect, and
> was not changed.

Independent of #2 — even once the resolver honours `permission`, these entries have nothing to
honour. **The original "7" undercounted: the real number is 11.** The first pass diffed only
V1's *named, top-level* routes; V1 also gates four *detail* sub-routes on two permissions that
do not exist anywhere in V2, and V2's Infrastructure merge silently widened two more.

### Coverage — every V2 route accounted for

The audit enumerated **all 61 V2 routes** across the four registries, not just the named ones:

| Area | Registry | Routes | Permission-bearing? |
|---|---|---|---|
| Auth | `auth.routes.ts` | 7 | **No — by construction** |
| Account | `account.routes.ts` | 13 | **No — by construction** |
| Server | `server.routes.ts` | 15 | Yes — 15 audited |
| Admin | `admin.routes.ts` | 26 | Yes — 26 audited |

Auth and Account are cleared *structurally*, not by inspection: in V1 the `permission` field is
declared only on `ServerRouteDefinition` (`utils.ts:15`) and `AdminRouteDefinition`
(`utils.ts:22`). The base `RouteDefinition` that `account.ts` uses has no such field, and V1 has
no auth registry at all. **V1 never gated an account or auth route**, so V2 cannot have dropped
one. That bounds the real audit surface to the 41 server + admin routes below.

### The 11 gaps

| # | Area | Route | V1 gate | V2 gate | Kind |
|---|---|---|---|---|---|
| 1 | Server | `''` (Console) | `control.console` | *(none)* | dropped |
| 2 | Server | `custom-domains/*` | `allocation.*` | *(none — condition only)* | dropped |
| 3 | Server | `billing/*` | `billing.*` | *(none — condition only)* | dropped |
| 4 | Admin | `theme` | `theme.read` | *(none)* | dropped |
| 5 | Admin | `alerts/*` | `alerts.read` | *(none)* | dropped |
| 6 | Admin | `email/*` | `email.read` | *(none — condition only)* | dropped |
| 7 | Admin | `extensions/*` | `extensions.read` | *(none — condition only)* | dropped |
| 8 | Admin | `servers/presets` | `server-presets.read` | folded into `infrastructure/*` | **widened** |
| 9 | Admin | `servers/presets/:id/*` | `server-presets.read` | folded into `infrastructure/*` | **widened** |
| 10 | Admin | `nests/:nestId/new` | `eggs.read` | folded into `nests/*` (`nests.read`) | **widened** |
| 11 | Admin | `nests/:nestId/eggs/:id/*` | `eggs.read` | folded into `nests/*` (`nests.read`) | **widened** |

Sources: `resources/scripts/routers/routes/{server,admin}.ts` vs `frontend/src/routes/{server,admin}.routes.ts`.

**1–7 (dropped).** The pattern suggests accident, not decision — a feature-flag `condition` was
added and the permission went missing in the same edit for `custom-domains`, `billing`, `email`
and `extensions`. A `condition` answers *"is this module on?"*; a `permission` answers *"may this
user use it?"*. They are not substitutes. The Console one is the most user-visible: **every**
subuser sees the Console tab, including those without `control.console`.

**8–11 (widened) — new, and the reason the first count was wrong.** Two permissions that exist
in the backend (`AdminRole::SERVER_PRESETS_READ`, `AdminRole::EGGS_READ`) and gate live V1
routes appear **nowhere in `frontend/src`** — `grep -rn "eggs.read\|server-presets.read" frontend/src`
returns nothing. The pages themselves were ported
([`PresetManager.tsx`](../../frontend/src/pages/admin/infrastructure/PresetManager.tsx),
[`EggEditorPage.tsx`](../../frontend/src/pages/admin/nests/egg/EggEditorPage.tsx)) — only their gates
were not. So presets are now reachable by anyone with `nodes.read`, and the egg editor by anyone
with `nests.read`. These are **privilege widenings**, not just missing checks: a role that V1
deliberately kept out of egg editing now gets in.

### Also widened: the Infrastructure merge turned an AND-space into an OR

```ts
// frontend/src/routes/admin.routes.ts:81
route('infrastructure/*', { permission: ['nodes.read', 'servers.read'], … })
```

`can()` treats an array as **any-of** (`wanted.some(…)`, `lib/can.ts:14`). V1 had two separate
routes — `nodes/*` gated `nodes.read`, `servers/*` gated `servers.read`. V2 merged the pages
into one section behind an OR, so **`nodes.read` alone now admits you to the servers half, and
`servers.read` alone to the nodes half.** Whether that's acceptable is a product call — the
merged section may be the point — but it is a real V1→V2 permission change and it should be a
decision, not a side effect of the merge. If the split still matters, the gate belongs on the
tabs inside `InfrastructureSection`, not on the route.

---

## 4. V2 has no CI coverage

`.github/workflows/ui.yaml` runs, from the repo root:

```yaml
- run: pnpm install
- run: pnpm run lint     # → "eslint resources/scripts"   (V1)
- run: pnpm run build    # → "vite build"                 (V1)
```

There is **no root `pnpm-workspace.yaml`** — `ui/` is a fully separate pnpm project with its
own lockfile and its own `vite.config.ts`. Nothing in CI ever `cd`s into it.

So the workflow named "UI" builds V1 and ignores V2 completely. V2 is never type-checked
(`tsc -b`), never built, never linted in CI — its `build` script, which also runs the Paraglide
compile that enforces i18n key coverage, only ever runs locally.

This is a blocker in the ordinary sense: at cutover, CI would lint and build a **deleted** V1
and never touch the shipping UI. Fix before, not after — otherwise the deletion commit is the
first one whose breakage CI cannot see.

---

## 5. The extension installer only knows V1's frontend path

> Corrected 2026-07-16. An earlier revision of this finding said "V2 ships zero extension
> packages" and treated it as a porting gap. That was wrong: **no** package is shipped by this
> repo — not for V1 either. Both package trees are gitignored install output:
>
> ```
> .gitignore:21  # Extension system runtime state and installed/uninstalled package output
> .gitignore:28  app/Extensions/Packages/
> .gitignore:29  resources/scripts/extensions/packages/
> ```
>
> `git ls-files app/Extensions/Packages/` returns **zero** tracked files. Packages live in the
> separate extensions repo and arrive via `p:extensions:install`. Whatever is on a given box —
> `palworld_server_manager` and nine others on the audit box — is install state, not source, and
> says nothing about V2.

The real blocker is the **install target**. `ExtensionPackageArtifactService.php:284` hardcodes
V1's frontend directory when it places a package's frontend:

```php
sprintf('resources/scripts/extensions/packages/%s/', $extensionId),
```

V2's registry (`frontend/src/pages/server/extensions/registry.ts:18`) globs a *different*, currently
nonexistent directory that nothing ever writes to:

```ts
import.meta.glob('../../../extensions/packages/**/meta.json', ...)   // → frontend/src/extensions/packages/
```

So V2's Extensions gallery is wired correctly and can never list a package — not because packages
weren't ported, but because **the installer has no V2 target to write to.** The two ends of the
same convention (drop a folder with `meta.json` + `index.tsx`, no central list to edit) were
ported; the path between them wasn't.

### What this requires at cutover

The installer must be **retargeted**, and the target it moves to is a Phase 1 output, not today's
path. Once `ui/` → `frontend/` ([02 Phase 1](./02-cutover-plan.md#phase-1--rename-ui--frontend)),
the registry glob resolves to:

```
frontend/src/extensions/packages/<id>/     ← the new install target
```

Sequence that falls out of it:

1. **Phase 1** renames `ui/` → `frontend/`. The V2 target path is only stable after this — retargeting
   the installer before it means editing the same line twice.
2. **Retarget** `ExtensionPackageArtifactService.php:284` to `frontend/src/extensions/packages/%s/`,
   and add `frontend/src/extensions/packages/` to `.gitignore` alongside the two existing entries —
   it is install output and must not become tracked source.
3. **Repackage** in the extensions repo. This is not a path swap alone: each package's frontend is
   V1-shaped (i18next strings, V1 component imports) and V2 requires Paraglide `m['ns.key']()` plus
   theme CSS vars. Budget real work per package.
4. **Reinstall** from the extensions repo against the new target, then verify the gallery lists them.

Uninstalling everything first (`php artisan p:extensions:uninstall <id>`) is the clean way to reach
a known state — `ExtensionPackageUninstallService` reverses the recorded file placement via
`ExtensionPackageFile` / `ExtensionFileSnapshot` rather than blind-deleting a folder — and it leaves
this checkout at its true committed state before `resources/scripts` is deleted.

### On the "live PHP backend" worry

`palworld_server_manager` has a live PHP backend (`routes/client.php`, controllers,
`Services/PalworldSettingsParser.php`) whose only frontend today is under `resources/scripts`. That
is real, but it is **not** a reason to hand-port a page into this repo: both halves are installed
artifacts of the same package, and uninstalling removes them together. Deleting `resources/scripts`
only orphans a backend if a package is left installed across the cutover — so make "no packages
installed" a precondition of the deletion commit, and let the extensions repo re-install afterwards.

(V1's `PlayerManagerContainer`, `InventoryViewer` and `discordsrv_helper` are dead in `resources/scripts`
— no importers — and need no port regardless. That part of the V2.md note checks out.)

---

## 6. PayPal cancel strands V2 users in V1

`app/Http/Controllers/Api/Client/Billing/PayPalCheckoutController.php:78-83`:

```php
$baseReturnUrl = $request->input('return_url', url('/account/billing/processing'));  // overridable ✅
$cancelUrl     = url('/account/billing/cancel');                                     // hardcoded ❌
```

The **return** URL is overridable and both V2 callers pass a V2 URL
(`PayPalButton.tsx:29`, `serverBilling.ts:197`). The **cancel** URL is not overridable at all.

So today, a V2 user who cancels a PayPal payment is dropped into the **V1** UI at
`/account/billing/cancel`. V2's own `CancelPage` (`account.routes.ts:34`) is unreachable from
the PayPal flow. After V1 is deleted, that URL 404s mid-payment-flow.

Fix alongside the return URL: accept a `cancel_url` input with the same default.

---

## 7. The V2 shell has no server-side auth middleware

`app/Providers/RouteServiceProvider.php:43` mounts the V2 shell **web-only**:

```php
Route::prefix('/v2')->group(base_path('routes/v2.php'));                       // no auth

Route::middleware(['auth.session', RequireTwoFactorAuthentication::class])
    ->group(base_path('routes/base.php'));                                     // V1 root

Route::middleware(['auth.session', RequireTwoFactorAuthentication::class, AdminAuthenticate::class])
    ->prefix('/admin')->group(base_path('routes/admin.php'));                  // V1 admin
```

This is deliberate and documented (guests need the landing page; the SPA guards itself), and
it's harmless while V2 is a secondary surface. It matters at the **root swap**: V1's `/admin`
is gated by `AdminAuthenticate` + `RequireTwoFactorAuthentication` server-side. If `/admin`
starts serving the V2 shell unchanged, those two gates disappear from the admin URL space, and
— given #2 — nothing client-side replaces them either.

The shell itself is just an HTML skeleton with no secrets, so serving it to a guest leaks
nothing. But "V1 enforced admin-ness and 2FA before rendering admin, V2 does not" is a
regression to make **consciously**, not by omission. Decide at Phase 2 (see
[02](./02-cutover-plan.md)); combining with #2's fix is the cheap path.

---

## 8. Admin Activity lost its feature condition

V1: `route('activity', ActivityContainer, { condition: flags => flags.activityEnabled, ... })`
V2: `route('activity', { ...permission: 'activity.read', element: AdminActivityPage })` — no condition.

The server-side Activity page handles its own disabled state (per V2.md), so this may be
intentional. Worth confirming the admin one does too, otherwise the tab shows with the module off.

---

## 9. Dead code in V2

The orphan sweep came back clean — `frontend/src` has **no never-imported files** (the only hit,
`src/i18n/index.ts`, is a false positive; it's imported as `@/i18n`). For a 408-file port that's
a good result. What there is:

| Item | Where | Notes |
|---|---|---|
| `Placeholder.tsx` unreachable | `frontend/src/pages/_shared/Placeholder.tsx`, used at `App.tsx:35` | Every registry entry now has an `element`, so the fallback can't render. Keep as a resolver safety net **or** delete with the flag below — but it's no longer a "not built yet" signal. |
| `RouteDef.placeholder` never read | written at `registry.ts:32`, declared `:27` | `route()` sets `placeholder: !opts.element` and nothing reads it. Dead field. |
| ~~`useServerHeld` never imported~~ | `frontend/src/layouts/heldPermissions.ts:17` | ✅ **Deleted 2026-07-15** with [#11](#11-the-admin-held-permission-set-is-a-phase-1-stub-every-admin-gets-). It was the stub's server-side twin (would have granted root admins `['*']`); `ServerLayout` uses the real `server.permissions` instead. |
| Stale doc link | `docs/V2.md:14` | Links to `frontend/src/pages/admin/billing/ComingSoon.tsx` — **deleted**. No `ComingSoon` reference remains in `frontend/src`. |
| V2.md parity claim | `docs/V2.md:29` | "every V2 page is now built — all four areas are at full page parity" is false while #1 stands. |

---

## 10. V1-only routes with no V2 equivalent

Reachable V1 admin paths that map to nothing in V2:

| V1 path | Maps to | V2 |
|---|---|---|
| `admin/plugins/*` | `MarketplaceRouter` (alias) | Only `admin/marketplace/*` — alias dropped |
| `admin/mods/*` | `MarketplaceRouter` (alias) | Only `admin/marketplace/*` — alias dropped |
| `admin/links/*` | `LinksContainer` | **Nothing** — see #1 |

Dropping the two aliases is reasonable (V2 deliberately has one canonical marketplace path),
but any bookmark or in-product link to them breaks silently at the root swap. Redirect map in
[02](./02-cutover-plan.md).

V2's `nodes/*` and `servers/*` → Infrastructure redirects already exist
(`admin.routes.ts:81-82`) and are the right precedent to follow.

---

## 11. The admin held-permission set is a Phase 1 stub (every admin gets `*`)

> ✅ **RESOLVED 2026-07-15 — the stub is gone.**
> [`heldPermissions.ts`](../../frontend/src/layouts/heldPermissions.ts) now fetches the real set from
> `GET /api/application/permissions` via a new [`api/adminPermissions.ts`](../../frontend/src/api/adminPermissions.ts)
> client (react-query, `staleTime: Infinity` — the set only changes when an operator edits the
> role, which reloads anyway). **No backend changes**: the endpoint was live the whole time.
>
> - `useAdminPermissions()` (new) returns `{ held, isLoading }` — for the route gate, which
>   needs the loading state.
> - `useAdminHeld()` keeps its `string[]` signature, so the ~15 pages doing in-page control
>   gating needed **no changes** — they were all written correctly against `can()` and were
>   simply being fed `['*']`. They now fail closed while the set loads, which is the right
>   default for a button.
> - Root admins bypass the request entirely (V1 parity: its SWR key was null for them), so the
>   common case adds no request and cannot flicker.
> - V1's flatten quirk is handled in the client: `AdminPermissionService` builds its return as
>   `$permissions[] = $role->permissions`, so the set arrives wrapped one level (`[[...]]`).
> - The arrays are module-level constants, preserving the React #185 warning the stub carried:
>   a fresh array per render is an unstable snapshot.
>
> **Not ported: V1's read-only banner.** `AdminReadOnlyBanner` + `isReadOnly()` warn a view-only
> admin up front instead of letting them fill a form and eat a 403 on submit. That is a
> genuine V1 affordance V2 still lacks — it is a UX gap, not a security one, and is now
> unblocked (the data it needs is finally there). Tracked below.
>
> `useServerHeld` was deleted as part of this (see [#9](#9-dead-code-in-v2)).
>
> The rest of this section is kept as the record of why a page-and-route parity sweep missed it.

**This is the finding the page-and-route diff could not see, and it is the prerequisite for #2
and #3.** Chasing "did we miss a route?" is the wrong axis: every admin route can carry a
correct `permission` and the admin area would *still* be ungated, because the permission set
they are checked against is a placeholder.

```ts
// frontend/src/layouts/heldPermissions.ts:12
export function useAdminHeld(): string[] {
    const isAdmin = useSession(s => Boolean(s.user?.root_admin || s.user?.admin_role_id));
    return useMemo(() => (isAdmin ? ['*'] : []), [isAdmin]);
}
```

Its own comment says so: *"Real per-server subuser permissions and the admin permission set
(`/api/application/permissions`) arrive in later phases."* Those phases did not arrive.

`admin_role_id` is set for **any** user with a restricted admin role. So every such user gets
`['*']`, and `can()` short-circuits on `held.includes('*')` (`lib/can.ts:6`) → **true for every
permission there is**. Granular admin roles are entirely unenforced client-side in V2.

The blast radius is wider than the router:

| Consumer | Count | Effect of the stub |
|---|---|---|
| `buildNav` (sidebar filter) | 1 | Every admin sees every tab — the nav filter in #2 never fires |
| Route gate (once #2 lands) | 26 | Would pass unconditionally — **#2 alone is a no-op for admin** |
| In-page gating (`can(held, …)` to hide create/update/delete controls) | **17 pages** | Every button renders for every admin; clicks 403 |

The 17: `ServersTable`, `BillingNav`, `CouponsPage`, `ProductsPage`, `CategoryDetailPage`,
`NodeHeader`, `NodeAllocationsTab`, `ApiKeysListPage`, `AdminTicketDetailPage`, `RoleDetailPage`,
`RolesListPage`, `InfrastructureOverviewPage`, `ServerHeader`, `ServerEditor`, `UsersListPage`
(+ the two layouts). Every one is written correctly against `can()` — they are all fed `['*']`.

**The backend is live and V1 already consumes it.** `GET /api/application/permissions`
(`routes/api-application.php:8` → `Api/Application/PermissionsController`) returns the real set;
V1 reads it in `plugins/useAdminPermissions.ts` with a root-admin bypass and a loading state.
V2 **never calls this endpoint** — `grep -rn "application/permissions" frontend/src` matches only the
comment above. Porting that hook is the fix, and it is not large; note V1's flatten quirk
(`AdminPermissionService` returns `[[...]]`, wrapped one level).

Two details worth carrying over from V1's guard, both currently absent from V2:

- **A loading state.** `RequireAdminPermission` renders a spinner while the set is in flight.
  Without one, a naive port flashes "Access Denied" before permissions land — fail *closed* on
  `undefined`, not on "not yet fetched". (Note this is the opposite of `FeatureGate`, which
  deliberately fails **open** on null flags; the two gates want opposite defaults.)
- **The read-only banner.** `AdminReadOnlyBanner` + `isReadOnly()` warn a view-only admin up
  front instead of letting them fill a form and eat a 403 on submit. V2 has no equivalent.

**Server area is fine.** `ServerLayout` feeds `buildNav` the real `server.permissions` from the
API, and the 18 server pages call `can(server.permissions, …)` directly. Server-side nav
filtering and in-page gating genuinely work today — which is why #2's resolver fix bites there
immediately and in admin not at all.

**Dead code:** `useServerHeld` (`heldPermissions.ts:17`) has **no importers** — `ServerLayout`
uses `server?.permissions` instead. It is the stub's server-side twin and would have granted
root admins `['*']`. Delete it with the fix; folds into #9.

---

## Improvements worth doing (not blockers)

- ~~**Honour `permission` in `resolveElement`**~~ — ✅ **done 2026-07-15**, as #11 → #2 → #3
  landed together (each was inert without the one before; the original "fixes #2 and #3 in one
  place" framing was wrong — see the correction under
  [#2](#2-v2-lost-client-side-route-permission-enforcement)).
- **Port V1's admin read-only banner.** `AdminReadOnlyBanner` + `isReadOnly()` (V1's
  `RequireAdminPermission`) tell a view-only admin up front that they can look but not touch,
  instead of letting them fill in a form and eat a 403 on submit. V2 has no equivalent. It was
  impossible to port while [#11](#11-the-admin-held-permission-set-is-a-phase-1-stub-every-admin-gets-)
  was stubbed — every admin looked like they held `*`, so nobody was ever read-only — and is now
  unblocked: `useAdminPermissions()` returns the real set, and V1's `WRITE_KEYS` /
  `READ_ONLY_EXEMPT` logic ports directly. 🟢 UX gap, not a security one.
- **Derive the `/v2` prefix instead of hardcoding it.** It appears **170 times across 85 files**
  in `frontend/src` (worst: `OverviewPage.tsx` ×15, `App.tsx` ×8) plus `LandingConfigService.php:93`.
  This is the single largest mechanical cost of the root swap — a `basename` constant or router
  basename would make Phase 2 a config change instead of an 85-file sed. **Do this before the
  swap, not during.**
- **Fold `ui/` into a root pnpm workspace** as part of the rename (#4), so one `pnpm install`
  and one CI job cover both trees during the overlap.
- **Delete `RouteDef.placeholder`** and decide `Placeholder`'s fate (#9).
- **Retire `/overview/version` + `/overview/metrics`** — see [03](./03-decommission-inventory.md);
  they're already marked and have V1-only consumers.

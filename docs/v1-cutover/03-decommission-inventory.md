# V1 Decommission Inventory

> **✅ EXECUTED 2026-07-16** — with one twist: everything in §1 was **moved to `archive/`
> rather than deleted** (user decision), except generated artifacts (`tsconfig.tsbuildinfo`,
> `public/build`) which were removed. §2's overview endpoints are gone. The V1 shell
> controller methods (`IndexController::index`, `LoginController::index`,
> `Admin\BaseController`) went with their templates.
>
> Original header: the kill list for **Phase 3** ([02](./02-cutover-plan.md)).
>
> ⚠️ **Read [§4 Do not delete](#4-do-not-delete-yet) before running anything.** Several live
> backends are reachable *only* through V1's frontend.

---

## 1. Frontend

| Target | Size | Notes |
|---|---|---|
| `resources/scripts/` | 813 files, 6.5M | The whole V1 SPA |
| `resources/views/templates/base/` + V1 Blade wrappers | — | Audit for shared partials before deleting |
| `public/build/` | — | V1 Vite output (`build-v2` is V2's) |
| `vite.config.mts` (root) | — | V1's build. **Not** `frontend/vite.config.ts` |
| `tailwind.config.js`, `postcss.config.cjs` (root) | — | V1 only — V2 uses `@tailwindcss/vite` |
| `tsconfig.json` (root), `tsconfig.tsbuildinfo` | — | V1 only — V2 has its own |
| `eslint.config.mjs` (root) | — | Only lints `resources/scripts` |
| Root `package.json` V1 deps + scripts | — | `build`/`dev`/`lint`/`test` all target V1. Keep the file; strip V1. |

Once V1's `public/build` is gone, rename V2's `build-v2` → `build` and `hot-v2` → `hot`
(`frontend/vite.config.ts:41-42`) and update `core.blade.php`.

## 2. Routes & endpoints

| Target | Where | Notes |
|---|---|---|
| `GET /api/application/overview/version` | `routes/api-application.php:15` | **Explicitly requested.** Superseded by the aggregate `/overview`. |
| `GET /api/application/overview/metrics` | `routes/api-application.php:16` | **Explicitly requested.** Same. |
| `OverviewController::version()` + `::metrics()` | `app/Http/Controllers/Api/Application/OverviewController.php` | Delete the methods with the routes; keep `index()` — V2 depends on it |
| `routes/base.php` V1 catch-all | `base.php:12` | `/{react}` — replaced in Phase 2 |
| V1 `routes/admin.php` catch-all | `admin.php:7` | Same |

### `/overview/{version,metrics}` — consumer check ✅

Both are already marked deprecated in-code (`api-application.php:11-14`). Every consumer is V1:

| Consumer | File |
|---|---|
| `getMetrics.ts` | `resources/scripts/api/routes/admin/getMetrics.ts:11` |
| `getVersion.ts` | `resources/scripts/api/routes/admin/getVersion.ts:18` |

V2 references them **only in a comment** (`frontend/src/api/adminOverview.ts:6-7`) explaining that
the aggregate `/overview` supersedes them. **No V2 code calls either.** They die with
`resources/scripts` — safe, and blocked on nothing but the deletion itself.

## 3. Dead V1 code (dies with the tree — listed so nobody ports it)

| Item | Notes |
|---|---|
| `components/server/extensions/PlayerManagerContainer.tsx` | Already dead in V1 — no importers |
| `components/server/extensions/InventoryViewer.tsx` | Already dead in V1 — no importers |
| `components/server/extensions/discordsrv_helper/` | Already dead in V1 — empty `staticRoutes` |
| `AdminRouteDefinition.advanced` | Set on 9 admin routes (`routes/admin.ts`), declared at `utils.ts:20`; the "Panel mode" concept it fed was replaced by V2's Features module |

## 4. Do not delete (yet)

**The list that turns a clean deletion into an outage.**

| Keep | Why |
|---|---|
| `app/Extensions/Packages/*`, `resources/scripts/extensions/packages/*` | ⚪ **Not ours to delete — gitignored install output**, not source (`.gitignore:28-29`; `git ls-files` returns zero). Packages come from the separate extensions repo via `p:extensions:install`. Do **not** hand-delete these folders: uninstall properly (`php artisan p:extensions:uninstall <id>`) so the PHP backend and its frontend go together and the file records stay consistent. Make **"no packages installed"** a precondition of the `resources/scripts` deletion commit — that is what prevents orphaning a live backend like `palworld_server_manager`. Reinstall after the installer is retargeted to `frontend/src/extensions/packages/` ([01 §5](./01-audit-findings.md#5-the-extension-installer-only-knows-v1s-frontend-path)). |
| `/api/application/links` + `/api/client/links` + `Link` model/transformers/requests | ✅ **Settled 2026-07-15 — keep permanently, not just "yet".** V2 ported the module ([01 §1](./01-audit-findings.md#1-the-admin-links-module-is-missing-from-v2)), so both endpoints now have V2 callers: `api/adminLinks.ts` (admin CRUD) and `api/links.ts` (user sidebar). Nothing here is V1-only. |
| `OverviewController::index()` | V2's admin dashboard depends on it |
| `resources/views/templates/v2/` | V2's shell |
| `frontend/` (ex-`ui/`) | The point of the exercise |
| `public/build-v2`, `public/hot-v2` | V2's build output |
| Everything under `app/`, `routes/api-*.php` not listed in §2 | V2 reuses the V1 API wholesale — **no backend changes were required by V2** (V2.md §5). The API is shared, not V1's. |

> The last row is the one to be careful about. "Delete V1" means **`resources/scripts` and its
> build chain** — *not* the Laravel API underneath it. V2 is a different frontend on the same
> backend.

## 5. Cleanups in V2 itself

From [01 §9](./01-audit-findings.md#9-dead-code-in-v2) — do these whenever, they're independent:

| Item | Where |
|---|---|
| `RouteDef.placeholder` — written, never read | `frontend/src/routes/registry.ts:27,32` |
| `Placeholder.tsx` — unreachable now every route has an `element` | `frontend/src/pages/_shared/Placeholder.tsx`, `app/App.tsx:17,35` |
| Stale `ComingSoon.tsx` link (file deleted) | `docs/V2.md:14` |
| False "full page parity" claim | `docs/V2.md:29` |

---

## Suggested deletion order

Each step is a commit; stop at any point and the tree is coherent.

1. Resolve **palworld** (§4) — this gates everything else. (**Links** was the other gate; ported
   2026-07-15, backend kept — nothing to do.)
2. Delete `/overview/version` + `/overview/metrics` routes + their controller methods (§2).
3. Delete `resources/scripts/` (§1).
4. Delete V1 build chain: root `vite.config.mts`, `tsconfig.json`, `eslint.config.mjs`,
   `tailwind.config.js`, `postcss.config.cjs`, V1 scripts/deps in root `package.json` (§1).
5. Delete V1 Blade templates + `public/build` (§1).
6. Rename `build-v2` → `build`, `hot-v2` → `hot`; update `core.blade.php` (§1).
7. `/v2/*` → 301 to root.
8. V2 cleanups (§5).

**Verify after 3-5:** `pnpm build` in `frontend/` is green, CI is green (it must be building
`frontend/` by now — [01 §4](./01-audit-findings.md#4-v2-has-no-ci-coverage)), the panel loads
at `/`, and `grep -rn "resources/scripts" --exclude-dir=node_modules .` is empty.

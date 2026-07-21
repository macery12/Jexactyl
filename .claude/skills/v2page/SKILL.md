---
name: v2page
description: >-
  Build or complete a page in the V2 React UI (frontend/) to full V1 parity. Use whenever
  the task is to create, finish, or overhaul a page/section under frontend/src/pages —
  e.g. "/v2page files", "build the server backups page", "finish admin activity".
  Drives the whole lifecycle: locate the V1 equivalent, agree the parity feature
  set, ask the style questions, build it (route + page + data + i18n + theme), run
  pnpm build, and update the docs/V2.md scoreboard. Enforces the two non-negotiables:
  every string externalized through frontend/messages/en.json (Paraglide) and every color
  from a theme CSS variable — never hardcoded.
---

# Building a V2 UI page

The V2 UI is a self-contained React app in [`frontend/`](../../../frontend/) that Laravel serves at `/v2`.
The goal of this overhaul is to reach **full V1 parity** — every V1 page gets a real V2 page
with the new full UI, not a stub. This skill turns "build page X" into a repeatable pipeline
so nothing drifts on i18n, theming, routing, or completeness.

**Two rules are MANDATORY on every page and are enforced by `pnpm build`:**
1. **i18n** — every user-facing string comes from `frontend/messages/en.json` via Paraglide `m['ns.key']()`.
2. **Theme** — every color comes from a theme CSS variable; no hex, no Tailwind palette colors.

Details of both are in [§ Non-negotiables](#non-negotiables) below. Read them before writing JSX.

---

## The pipeline

Run these in order. Do not skip step 0 (parity) or step 2 (style) — they are the two the user
specifically wants asked about, not assumed.

### 0. Locate the page and its V1 equivalent
- Open the scoreboard [`docs/V2.md`](../../../docs/V2.md) — find the row for the page. It tells you the
  V1 route, the intended V2 path, current status (⬜/🟡/✅), and the route registry that owns it.
- Open the V1 surface map [`docs/V1_UI_Map.md`](../../../docs/V1_UI_Map.md) — this is the **source of truth for
  what the page must do**. Read the V1 section so you know every feature, action, and endpoint to match.
- If a V1 controller/page exists in the Laravel app or the old frontend, skim it for the real
  behavior (permissions, API calls, edge cases). Parity means behavior, not just layout.

### 1. Agree the parity feature set
State back to the user the concrete list of things the page will do (the V1 capabilities you found),
so "complete fully" is a shared, checkable definition — not a guess. Confirm or adjust before building.

### 2. Ask the style questions (with a recommended fast-path)
Every page gets a deliberate design decision. Use **AskUserQuestion** and always lead with an
opinionated **recommended default** so the user can accept-all when in a hurry. Ask across these
three dimensions (pick the exemplar to copy from the table in [§ Layout patterns](#layout-patterns)):

- **Layout pattern** — tabs vs master–detail vs single sectioned page vs dense table vs dashboard grid vs ops cockpit.
- **Primary data component** — data table vs card grid vs list vs stat tiles vs form sections.
- **Density & chrome** — compact vs comfortable; page header/hero weight; toolbar/filter/search presence.

Frame the first option of each question as "(Recommended)" with your reasoning from the V1 behavior
and neighboring V2 pages, so the design feels consistent with what's already built.

### 3. Build the page fully
Wire up all of the following (see [§ How the app is built](#how-the-app-is-built) for the concrete shapes):

- **Route registry** — give the entry an `element` in the right `*.routes.ts` file so it stops
  rendering the shared `Placeholder`. Match the existing `route(path, { name, icon, category, permission, condition, element })` shape.
- **Page component(s)** under `frontend/src/pages/...` following the chosen layout's exemplar.
- **Data layer** — an `frontend/src/api/*.ts` module hitting the **existing Laravel API** via the shared
  `http` client, consumed with TanStack Query. Prefer no backend changes; the V2 overhaul reuses V1's API.
- **Mutations** — use the shared primitives `Modal`, `Select`, `ConfirmDialog`, the `editorChrome`
  section-card + sticky save-bar pattern for editors, `useFlashes` toasts, and TanStack query invalidation.
- **i18n keys** — add dotted, namespace-prefixed ids to `frontend/messages/en.json` (see rules below).
- **Theme** — every surface reads theme tokens.

### 4. Verify
- Run `cd ui && pnpm build` — this is `paraglide-js compile && tsc -b && vite build`. It **fails the
  build** on any i18n key that isn't in `en.json` and on type errors, so it's the real enforcement.
- Grep the new files for hardcoded colors/strings (audit commands in [§ Non-negotiables](#non-negotiables)).
- If the change has a runnable surface, drive it to confirm behavior (see the `/verify` skill).

### 5. Update the scoreboard
Edit [`docs/V2.md`](../../../docs/V2.md): flip the page's status (⬜→✅ or 🟡), fill in the V2 page link
and a short notes cell, and update the area's "Done / Partial / Not started" tallies at the top.
This keeps the cutover audit honest.

---

## Non-negotiables

### i18n — externalize every string via `frontend/messages/en.json` (Paraglide JS)
- Source strings live in **one flat file**, [`frontend/messages/en.json`](../../../frontend/messages/en.json), keyed by
  **namespace-prefixed dotted ids** (`"common.actions.save"`, `"server.backups.title"`). English is the
  source of truth. Namespaces: `common`, `nav`, `auth`, `landing`, `dashboard`, `server`, `admin`,
  `extensions`, `billing`. `common.*` holds shared `actions.*` / `states.*` / `power.*` / `metrics.*`.
- In components: `import { m } from '@/i18n'` then `m['ns.key']()` (bracket access — keys keep their dots).
  Interpolate with `m['ns.key']({ name })` against `"{name}"` in the catalog — **single braces**, not `{{name}}`.
- **Reuse shared atoms — don't duplicate.** Generic buttons/labels already exist: Cancel/Save/Close/Delete/
  Create/Discard → `common.actions.*`; `Save changes` → `common.actions.saveChanges`; `Saving…` →
  `common.states.saving`; generic error → `common.states.genericError`. Reference those instead of adding
  a per-namespace copy. Only add a page-local key when the wording genuinely differs.
- **Dynamic / runtime-built ids** (nav labels, server states, theme tokens) can't be referenced statically —
  use `td(id, fallback?)` from `@/i18n` with the FULL prefixed id: `td(\`admin.servers.state.${state}\`, label)`.
- **Plurals:** `m['ns.key']({ count })` with a `countPlural` selector/match in the catalog.
- **Markup inside a string** (links etc.): use `formatTags(message, { terms: <a/> })` from `@/i18n`, or split
  into segment keys and compose in JSX. Never embed JSX in the catalog.
- **Adding strings:** just add the id to `en.json` — no registration step; the compiler picks it up.
  Don't add other-locale files unless asked (Crowdin owns those). Exception: 3rd-party **manifest** copy
  (extension name/description/schema labels) is rendered verbatim and intentionally NOT catalogued.
- ⚠️ **Never `git checkout frontend/messages/en.json`** without checking for uncommitted keys first — it has
  silently discarded dozens of working-tree keys before.
- Copy the pattern from [`DashboardPage.tsx`](../../../frontend/src/pages/dashboard/DashboardPage.tsx) (static +
  interpolation) and [`Sidebar.tsx`](../../../frontend/src/components/shell/Sidebar.tsx) (dynamic `td`).

Audit before finishing: `grep -nE "'[A-Z][a-z].*'|\"[A-Z][a-z].*\"" <files>` for stray literal strings in JSX.

### Theme — use theme CSS variables, never hardcoded colors
- NEVER use raw hex (`#xxxxxx`) or Tailwind palette colors (`bg-zinc-900`, `text-white`, `border-slate-700`).
  Reference tokens via `bg-[var(--token)]` / `text-[var(--token)]` / `border-[var(--token)]`.
- Token vocabulary (set by `applyThemeVars` in [`frontend/src/lib/theme.ts`](../../../frontend/src/lib/theme.ts)):
  - Surfaces: `--color-canvas` (app bg), `--color-surface` (panels/sidebar), `--color-surface-2` (elevated/inputs/hover rows).
  - Borders: `--color-border` (hairline), `--color-border-strong` (defined edge).
  - Text: `--color-ink` (primary), `--color-ink-muted` (secondary), `--color-ink-faint` (captions).
  - Brand: `--brand`, `--brand-hover`, `--brand-soft` (active/selected bg). Text ON brand: `--color-brand-ink`.
  - Status: `--color-accent` (success/online), `--color-warning` (caution), `--color-danger` (error/destructive).
  - Radius: `style={{ borderRadius: 'var(--radius-card)' }}` for cards/buttons that honor the corner feel.
- Background grid/aurora are theme-controlled — reuse `.bg-grid` / `.bg-aurora`, don't hardcode textures.

Audit before finishing: `grep -nE "#[0-9a-fA-F]{3,6}|text-white|-(zinc|slate|gray|neutral|stone)-[0-9]" <files>`.

---

## How the app is built

Concrete shapes so the built page matches the codebase.

- **Stack:** React 19 + Vite (SWC), Tailwind v4, Radix UI + CVA (`frontend/src/components/ui`),
  react-router-dom v7, TanStack Query v5, Zustand, react-hook-form + zod.
- **Route registry** = single source of truth for routing **and** the sidebars. Add an `element` to
  the entry (lazy-imported) to render a real page; no `element` → shared `Placeholder`. Files:
  [`account.routes.ts`](../../../frontend/src/routes/account.routes.ts),
  [`admin.routes.ts`](../../../frontend/src/routes/admin.routes.ts),
  [`server.routes.ts`](../../../frontend/src/routes/server.routes.ts),
  [`auth.routes.ts`](../../../frontend/src/routes/auth.routes.ts). Entry:
  `route('files/*', { name: 'Files', icon: FolderOpen, permission: 'file.*', category: 'data', element: FilesSection })`.
  `condition: f => f.<flag>.enabled` gates on feature flags. Nested sections use a `Section` component
  with its own internal `<Routes>` (see how billing/extensions/infrastructure do it).
- **Data:** the existing Laravel API via [`frontend/src/lib/http.ts`](../../../frontend/src/lib/http.ts) (axios + CSRF).
  Client endpoints under `/api/client/*`, admin under `/api/application/*`. Wrap calls in an
  `frontend/src/api/<feature>.ts` module and consume with `useQuery`/`useMutation`. Server-cockpit live data
  is a websocket ([`frontend/src/lib/Websocket.ts`](../../../frontend/src/lib/Websocket.ts) → `serverSocket` store).
- **Shared primitives:** `Modal`, `Select`, `ConfirmDialog` (Radix), `Panel` (ops chrome),
  `editorChrome` (section cards + sticky save-bar for editors), `useFlashes` (toasts). Reuse these
  rather than rolling new ones.

---

## Layout patterns

Pick a skeleton, then copy the exemplar's structure. All exemplars already follow the two non-negotiables.

| Pattern | Use for | Exemplar to copy |
|---|---|---|
| **Ops cockpit** (metric strip + hero + panel rows) | live/monitoring pages | [`ServerOverviewPage.tsx`](../../../frontend/src/pages/server/ServerOverviewPage.tsx) + `server/panels/Panel.tsx` |
| **Tabbed cockpit** | one entity, many facets | [`NodeDetailPage.tsx`](../../../frontend/src/pages/admin/nodes/NodeDetailPage.tsx) |
| **Single sectioned editor** (scrollspy nav + sticky save bar) | edit forms with many sections | `ServerEditor` / [`CategoryDetailPage.tsx`](../../../frontend/src/pages/admin/billing/products/CategoryDetailPage.tsx) + `editorChrome.tsx` |
| **Master–detail + live preview** | list ↔ edit with a canvas | [`LandingSection.tsx`](../../../frontend/src/pages/admin/landing/LandingSection.tsx) |
| **Dense table** | large flat record sets | [`ServersTable.tsx`](../../../frontend/src/pages/admin/servers/ServersTable.tsx) |
| **Card grid + filter/search** | browsable catalogs | [`ExtensionsOverviewPage.tsx`](../../../frontend/src/pages/admin/extensions/ExtensionsOverviewPage.tsx) |
| **Dashboard tiles** | overviews/analytics | [`DashboardPage.tsx`](../../../frontend/src/pages/dashboard/DashboardPage.tsx) / `BillingOverviewPage.tsx` |
| **Nested section w/ in-page nav** | a multi-page module under one entry | `BillingSection.tsx` + `BillingNav.tsx` |

---

## Definition of done

- [ ] V1 parity list confirmed and every item implemented (behavior, not just layout).
- [ ] Style questions asked; chosen layout matches an exemplar.
- [ ] Route entry has an `element`; page no longer renders `Placeholder`.
- [ ] Data comes from the existing API via `http` + TanStack Query; no needless backend changes.
- [ ] All strings in `frontend/messages/en.json`; shared `common.*` atoms reused; no literal JSX strings.
- [ ] All colors are theme tokens; color/string grep audits are clean.
- [ ] `cd ui && pnpm build` passes.
- [ ] Behavior verified against the running app where there's a surface to drive.
- [ ] `docs/V2.md` scoreboard updated (status, link, notes, tallies).

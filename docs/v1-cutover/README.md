# V1 → V2 Cutover

> **Status: ✅ EXECUTED 2026-07-16** on `overhaul/frontend`. V2 serves at the site root;
> V1 lives in [`archive/`](../../archive/) (reference only). Two deviations from the plan
> below, both user decisions at execution time:
>
> 1. **V1 was archived, not deleted, and with no bake period** — `archive/resources-scripts/`,
>    `archive/views/`, `archive/build-chain/`, `archive/controllers/`. Git history + the
>    archive folder are the rollback.
> 2. **`/v2/*` gets no redirects** — the prefix simply stopped existing (old URLs render the
>    SPA's NotFound). The V1 URL inversions (`/account` → `/settings` etc.) *are* 301s in
>    `routes/base.php`; the marketplace aliases 301 in `routes/admin.php`.
>
> Also executed: `/admin` kept V1's server-side gates (finding #7 → "keep"); the extension
> installer targets `frontend/src/extensions/packages/` (#5); the 10 bugged package installs
> were uninstalled/hand-deleted; CI builds+lints `frontend/` (#4); PayPal `cancel_url` is
> overridable (#6); admin Activity handles its disabled state in-page (#8); dead code removed (#9).

> Original planning header: Audited 2026-07-15 on `overhaul/frontend`.

This folder documents retiring the V1 UI (`resources/scripts`) and promoting V2 (`ui/`)
to be *the* panel UI — served at the site root, out of a folder that isn't called `ui`.

## The three decisions this plan is built on

| Decision | Choice |
|---|---|
| What `ui/` gets renamed to | **`frontend/`** |
| Where V2 is served at cutover | **The site root `/`**; `/v2/*` 301s to root, V1 routes deleted |
| Dead V1 code/routes | Removed, not left behind — inventory in [03](./03-decommission-inventory.md) |

## Read in this order

| Doc | What it answers |
|---|---|
| [01 — Audit findings](./01-audit-findings.md) | Did we miss anything? What's dead or worth improving? **Read this first — it contains cutover blockers.** |
| [02 — Cutover plan](./02-cutover-plan.md) | The phased sequence: rename → root swap → V1 deletion. Includes the URL redirect map. |
| [03 — Decommission inventory](./03-decommission-inventory.md) | The exact kill list: files, routes, endpoints, and what must **not** be deleted. |

## Headline: "full page parity" was not quite true

[`V2.md`](../V2.md) claimed every V2 page was built and only cutover chores remained.
The audit found that is **almost** right, with real exceptions:

- ~~**The admin Links module was missed entirely**~~ — it wasn't in V2 *and* wasn't on the V2.md
  scoreboard, yet its backend was live and V1 showed custom links in the end-user nav.
  ✅ **Ported 2026-07-15** (admin editor + user sidebar surface, backend kept). It remains the
  best illustration of the point below: a page-parity scoreboard cannot find a page nobody
  listed.
- **Client-side route permission enforcement was lost in the V2 port.** V1 wrapped every
  route in a permission guard; V2 only hides nav entries.
- **V2 has no CI coverage at all** — it is never built, linted, or type-checked.
- **The extension installer only knows V1's frontend path** — it hardcodes
  `resources/scripts/extensions/packages/`, so V2's registry can never see a package. It must be
  retargeted to `frontend/src/extensions/packages/` *after* the Phase 1 rename. (Packages
  themselves are gitignored install output from the separate extensions repo — nothing to port
  into this tree.)

None of the remaining three are page work, and all three are cutover blockers. See
[01](./01-audit-findings.md).

**Status:** Links is closed. Findings 2–7 are still open — the blockers are now entirely
non-page work, which is exactly why the scoreboard reads "done" and the panel isn't ready.

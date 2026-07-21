# Archive — V1 frontend

**Archived 2026-07-16** as the final phase of the V1 → V2 cutover
(see [`docs/v1-cutover/`](../docs/v1-cutover/)). The V2 UI in
[`frontend/`](../frontend/) serves at the site root; nothing in this
folder is built, routed, linted, or autoloaded.

**Reference only — nothing may import from here.**

| Folder | What it was |
|---|---|
| `resources-scripts/` | The V1 React SPA (`resources/scripts`) |
| `views/` | V1 Blade shells: `templates/base`, `templates/auth`, `templates/wrapper.blade.php` |
| `build-chain/` | V1's root build tooling: `vite.config.mts`, `tailwind.config.js`, `postcss.config.cjs`, `tsconfig.json`, `eslint.config.mjs` |
| `controllers/` | `Admin\BaseController` — served the V1 admin shell; its routes now serve the V2 shell |

The V1 root `package.json` dependencies/scripts were stripped in place
(root scripts now delegate to `frontend/`); consult git history for the
original file. The Laravel API was never V1-specific and remains fully
live — V2 is a different frontend on the same backend.

---
name: lint
description: Run every CI lint gate for the m12labs panel and drive the project to fully linted. Use to lint, check CI lint, fix lint, run php-cs-fixer / eslint / phpstan / tsc typecheck, or diagnose why the Laravel "Lint" or UI "Lint"/"Build" CI jobs are red. Auto-fixes what is fixable and reports what needs hand-fixing.
---

# lint — run all CI lint gates for the panel

This panel's lint is spread across **three tools in two languages**, wired into
CI as separate jobs. One driver runs them all: **`.claude/skills/lint/lint.sh`**
(paths below are relative to the repo root, `/var/www/m12labs`).

| Gate | Tool | CI job | Auto-fixable? |
|------|------|--------|---------------|
| PHP style | `php-cs-fixer` | `laravel.yaml` → **Lint** | ✅ `./lint.sh fix php` |
| JS/TS lint | `eslint src` | `ui.yaml` → **Lint** | ⚠️ partly (`--fix`); rest by hand |
| TS typecheck | `tsc -b` | `ui.yaml` → **Build** | ❌ hand-fix |
| PHP static analysis | `phpstan` | *(local only — not in CI)* | ❌ hand-fix |

> PHPStan is a **local** quality gate (`phpstan.neon`). No CI workflow runs it —
> `release.yaml` even deletes `phpstan.neon` when packaging — so `check` skips it.
> Ask for it with `./lint.sh stan` or `./lint.sh all`.

## Run (agent path) — start here

```bash
# from the repo root
.claude/skills/lint/lint.sh check     # all CI gates, PASS/FAIL summary, exit 1 if any fail
```

Everything the driver accepts:

```bash
.claude/skills/lint/lint.sh check     # php + js + types (mirrors CI)   ← default
.claude/skills/lint/lint.sh all       # check + phpstan (CI + local)
.claude/skills/lint/lint.sh fix       # php-cs-fixer fix + eslint --fix, then re-check
.claude/skills/lint/lint.sh fix php   # only php-cs-fixer fix
.claude/skills/lint/lint.sh fix js    # only eslint --fix
.claude/skills/lint/lint.sh php       # single gate: PHP CS Fixer (dry-run)
.claude/skills/lint/lint.sh js        # single gate: ESLint
.claude/skills/lint/lint.sh types     # single gate: tsc -b
.claude/skills/lint/lint.sh stan      # single gate: PHPStan (local)
```

The driver resolves the repo root itself (`git rev-parse --show-toplevel`), so it
works from any subdirectory. Per-gate logs land in a temp dir printed on failure.

## Getting to fully linted

The bulk of the "issues" (~622 tracked files) is PHP formatting — **entirely
auto-fixable**. Do it in this order:

```bash
.claude/skills/lint/lint.sh fix php   # 622 tracked PHP files → 0 (php-cs-fixer rewrites them)
.claude/skills/lint/lint.sh fix js    # eslint --fix clears the trivially-fixable warnings
.claude/skills/lint/lint.sh check     # see what's left — the hand-fix remainder
```

What remains after `fix` needs manual work:
- **ESLint:** 1 error + ~88 warnings, almost all `react-hooks/*`
  (`set-state-in-effect`, `incompatible-library`). `--fix` cannot resolve these —
  edit the components. **CI only fails on the *error*** (`eslint src` exits 1 on
  errors; warnings alone exit 0), so clearing the single error unblocks the UI
  Lint job even before every warning is gone.
- **PHPStan (local):** 35 errors (`nullCoalesce.*`, undefined offsets, etc.).

## State captured when this skill was written (2026-07-22, branch `develop`)

```
PHP CS Fixer   622 tracked files need reformatting (exit 8)   ← auto-fix
ESLint          90 problems: 1 error, 89 warnings  (exit 1)
tsc -b           0 errors — clean ✓
PHPStan         35 errors (local gate)
```

622 is the **CI-relevant** count (tracked files only — what a fresh CI checkout
sees). A local tree may report *more* if you have gitignored extension packages
under `app/Extensions/Packages/` with style drift — see Gotchas.

## Prerequisites

Already provisioned in this container — verify with the commands the driver relies on:

```bash
php --version            # 8.3.31
node --version           # v22.22.2
pnpm --version           # 10.32.0
ls vendor/bin/php-cs-fixer vendor/bin/phpstan   # composer deps present
ls frontend/node_modules >/dev/null && echo ok  # pnpm deps present
```

If either dependency tree is missing, the driver installs it automatically before
the first gate that needs it (`composer install --no-interaction --prefer-dist`
for PHP, `pnpm --dir frontend install` for JS) — same as CI does.

## Human path (raw commands the driver wraps)

Only if you want to bypass the driver:

```bash
vendor/bin/php-cs-fixer fix --dry-run --diff              # PHP style check
vendor/bin/php-cs-fixer fix                               # PHP style FIX (writes files)
( cd frontend && pnpm run lint )                          # eslint src
( cd frontend && pnpm exec tsc -b )                       # typecheck
vendor/bin/phpstan analyse --no-progress --memory-limit=1G   # static analysis
```

## Gotchas

- **php-cs-fixer prints a JSON report here, not the usual dot/txt output** — even
  with `--format=txt --sequential`. This 3.95.3 build ignores the reporter choice
  in this container. Don't parse for a human "N) path" list; key off the **exit
  code** (`8` = files need fixing, `0` = clean) and count `"name":` occurrences.
  The driver already does this.
- **ESLint exit code vs. count.** `eslint src` exits **1 only when there are
  errors**; a run with 89 warnings and 0 errors exits **0** and CI passes. "Fully
  linted" (0 problems) is stricter than "CI green" (0 errors). The driver's
  ESLint gate reflects the CI rule (fails on error), but still prints the warning
  count so you can drive it all the way to zero.
- **`php-cs-fixer fix` rewrites hundreds of files at once** (622 tracked here).
  Run it on a clean/committed tree so the diff is reviewable and revertible with
  `git checkout -- .`.
- **The fixer also reformats gitignored extension packages.** The finder in
  `.php-cs-fixer.dist.php` scans the whole repo (only `vendor/node_modules/storage/
  bootstrap/cache` excluded), so `app/Extensions/Packages/**` gets linted too —
  including the gitignored, runtime-installed copies. `fix` rewrites those local
  files, and `git checkout -- .` **cannot** revert them (git doesn't track them).
  CI never sees them (fresh checkout has only tracked files), so they don't affect
  the CI count — but they do inflate your *local* count and their reformat is not
  undoable. If you want the fixer to leave them alone, run on a tree without those
  packages present, or add them to the finder's `exclude()`.
- **PHPStan is not in CI.** Don't block a PR on `stan` failures thinking CI will —
  it won't. It's a local-quality signal only.
- **PHP CS Fixer caches** in `.php-cs-fixer.cache` (gitignored). A stale cache can
  hide/relist files; delete it if counts look wrong.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `cannot cd to repo root` | Run inside the git working tree (driver uses `git rev-parse`). |
| php-cs-fixer exit `8` | Expected — means files need fixing. Run `./lint.sh fix php`. |
| PHPStan OOM / "Allowed memory exhausted" | Already run with `--memory-limit=1G`; raise it in the driver if the codebase grows. |
| ESLint `Cannot find module` after a dep bump | `pnpm --dir frontend install`, then re-run. |
| `tsc -b` stale after editing types | Delete `frontend/tsconfig.tsbuildinfo` (incremental cache) and re-run. |

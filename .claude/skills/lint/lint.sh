#!/usr/bin/env bash
#
# lint.sh — drive every CI lint gate for the m12labs panel from one place.
#
# The panel has three separate CI lint surfaces living in different tools:
#   1. PHP CS Fixer  (.github/workflows/laravel.yaml  → `Lint` job)
#   2. ESLint        (.github/workflows/ui.yaml        → `Lint` job)
#   3. tsc typecheck (.github/workflows/ui.yaml        → `Build` job, `tsc -b`)
# PHPStan is a LOCAL quality gate (phpstan.neon) — it is NOT run by any CI
# workflow, so it is only checked when you ask for it explicitly (`stan`/`all`).
#
# Usage:
#   ./lint.sh                # == check   (run every CI gate, report, exit 1 on any fail)
#   ./lint.sh check          # run php + js + types in dry-run, print PASS/FAIL summary
#   ./lint.sh fix            # auto-fix php-cs-fixer + eslint, then re-run check
#   ./lint.sh php            # only PHP CS Fixer     (dry-run)
#   ./lint.sh js             # only ESLint           (no --fix)
#   ./lint.sh types          # only tsc -b typecheck
#   ./lint.sh stan           # only PHPStan          (local gate, not in CI)
#   ./lint.sh all            # check + stan          (everything, CI + local)
#   ./lint.sh fix php        # fix only PHP CS Fixer
#   ./lint.sh fix js         # fix only ESLint (eslint src --fix)
#
# Exit code: 0 if every requested gate is clean, 1 otherwise. Mirrors CI.

set -uo pipefail

ROOT="$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)"
cd "$ROOT" || { echo "cannot cd to repo root"; exit 2; }

LOGDIR="$(mktemp -d "${TMPDIR:-/tmp}/m12labs-lint.XXXXXX")"
trap 'rm -rf "$LOGDIR"' EXIT

# --- pretty ------------------------------------------------------------------
if [ -t 1 ]; then B=$'\033[1m'; R=$'\033[31m'; G=$'\033[32m'; Y=$'\033[33m'; C=$'\033[36m'; Z=$'\033[0m'
else B=; R=; G=; Y=; C=; Z=; fi
pass() { printf '%s  PASS%s  %s\n' "$G" "$Z" "$1"; }
fail() { printf '%s  FAIL%s  %s\n' "$R" "$Z" "$1"; }
head() { printf '\n%s== %s ==%s\n' "$B" "$1" "$Z"; }

# --- ensure deps are installed (CI runs composer/pnpm install first) ---------
ensure_php() {
  [ -x vendor/bin/php-cs-fixer ] || { head "composer install"; composer install --no-interaction --no-progress --prefer-dist; }
}
ensure_js() {
  [ -d frontend/node_modules ] || { head "pnpm install (frontend)"; pnpm --dir frontend install; }
}

# --- gates -------------------------------------------------------------------
# Each gate prints its own header + a PASS/FAIL line and returns 0/1.

gate_php() {                       # PHP CS Fixer — CI: laravel.yaml Lint
  ensure_php
  head "PHP CS Fixer  (vendor/bin/php-cs-fixer fix --dry-run)"
  local log="$LOGDIR/phpcs.log"
  vendor/bin/php-cs-fixer fix --dry-run --diff >"$log" 2>&1
  local code=$?
  # NOTE: this php-cs-fixer build emits a JSON report even for the txt reporter,
  # so we key off the exit code (8 = files need fixing) and count "name": keys.
  local n; n=$(grep -o '"name":' "$log" | wc -l | tr -d ' ')
  if [ "$code" -eq 0 ]; then pass "PHP CS Fixer — style clean"; return 0
  else fail "PHP CS Fixer — ${n} file(s) need reformatting (run: ./lint.sh fix php)"; return 1; fi
}

gate_js() {                        # ESLint — CI: ui.yaml Lint  (`pnpm run lint` = `eslint src`)
  ensure_js
  head "ESLint  (frontend: eslint src)"
  local log="$LOGDIR/eslint.log"
  pnpm --dir frontend exec eslint src >"$log" 2>&1
  local code=$?
  local summary; summary=$(grep -E '✖ [0-9]+ problem' "$log" | tail -1)
  if [ "$code" -eq 0 ]; then
    [ -n "$summary" ] && printf '  %s%s%s\n' "$Y" "$summary" "$Z"   # warnings-only still exits 0
    pass "ESLint — no errors"; return 0
  else
    printf '  %s%s%s\n' "$R" "${summary:-see log}" "$Z"
    fail "ESLint — errors present (log: $log)"; return 1
  fi
}

gate_types() {                     # tsc -b — CI: ui.yaml Build (`pnpm run build` runs `tsc -b`)
  ensure_js
  head "TypeScript typecheck  (frontend: tsc -b)"
  local log="$LOGDIR/tsc.log"
  pnpm --dir frontend exec tsc -b >"$log" 2>&1
  local code=$?
  local n; n=$(grep -cE 'error TS' "$log")
  if [ "$code" -eq 0 ]; then pass "tsc — typecheck clean"; return 0
  else fail "tsc — ${n} type error(s) (log: $log)"; return 1; fi
}

gate_stan() {                      # PHPStan — LOCAL ONLY, not in any CI workflow
  ensure_php
  head "PHPStan  (vendor/bin/phpstan analyse)  ${Y}[local gate — not in CI]${Z}"
  local log="$LOGDIR/phpstan.log"
  vendor/bin/phpstan analyse --no-progress --memory-limit=1G >"$log" 2>&1
  local code=$?
  local n; n=$(grep -oE 'Found [0-9]+ error' "$log" | grep -oE '[0-9]+' | tail -1)
  if [ "$code" -eq 0 ]; then pass "PHPStan — no errors"; return 0
  else fail "PHPStan — ${n:-?} error(s) (log: $log)"; return 1; fi
}

# --- fixers ------------------------------------------------------------------
fix_php() {
  ensure_php
  head "FIX: php-cs-fixer fix  (rewrites files in place)"
  vendor/bin/php-cs-fixer fix
}
fix_js() {
  ensure_js
  head "FIX: eslint src --fix  (rewrites files in place)"
  pnpm --dir frontend exec eslint src --fix
  echo "${Y}note:${Z} most ESLint findings are react-hooks warnings that --fix cannot resolve; fix those by hand."
}

# --- dispatch ----------------------------------------------------------------
run_check() {
  local rc=0
  gate_php   || rc=1
  gate_js    || rc=1
  gate_types || rc=1
  echo
  if [ "$rc" -eq 0 ]; then printf '%s  ✓ all CI lint gates clean%s\n' "$G" "$Z"
  else printf '%s  ✗ CI lint not clean%s  — run ./lint.sh fix, then re-check\n' "$R" "$Z"; fi
  return $rc
}

cmd="${1:-check}"
case "$cmd" in
  check)  run_check ;;
  all)    rc=0; run_check || rc=1; gate_stan || rc=1; exit $rc ;;
  php)    gate_php   ;;
  js)     gate_js    ;;
  types)  gate_types ;;
  stan)   gate_stan  ;;
  fix)
    target="${2:-both}"
    case "$target" in
      php)  fix_php ;;
      js)   fix_js  ;;
      both) fix_php; fix_js ;;
      *)    echo "unknown fix target: $target (php|js|both)"; exit 2 ;;
    esac
    head "re-checking after fix"
    run_check ;;
  -h|--help|help) sed -n '2,40p' "${BASH_SOURCE[0]}" ;;
  *) echo "unknown command: $cmd (try: check | fix | php | js | types | stan | all)"; exit 2 ;;
esac

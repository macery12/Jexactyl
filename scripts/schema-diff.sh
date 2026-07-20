#!/usr/bin/env bash
#
# Schema drift check (docs/database-rebuild/03, "safety net").
#
# Migrates the current migration set into a scratch database, dumps the
# structure, and diffs it against the committed ground-truth dump
# (database/schema/fresh-schema.sql). Run after changing migrations and
# commit the regenerated dump when the diff is intentional.
#
# Requires: root socket access to MariaDB (or set MYSQL_CLI / MYSQLDUMP_CLI),
# and an app DB user matching .env for the artisan run.
#
# Usage: scripts/schema-diff.sh [scratch_db_name]

set -euo pipefail

cd "$(dirname "$0")/.."

SCRATCH_DB="${1:-m12_schema_drift_check}"
BASELINE="database/schema/fresh-schema.sql"
MYSQL_CLI="${MYSQL_CLI:-mariadb -u root}"
MYSQLDUMP_CLI="${MYSQLDUMP_CLI:-mariadb-dump -u root}"
APP_DB_USER="$(grep '^DB_USERNAME=' .env | cut -d= -f2-)"

$MYSQL_CLI -e "DROP DATABASE IF EXISTS \`$SCRATCH_DB\`;
  CREATE DATABASE \`$SCRATCH_DB\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  GRANT ALL PRIVILEGES ON \`$SCRATCH_DB\`.* TO '$APP_DB_USER'@'127.0.0.1';"

DB_DATABASE="$SCRATCH_DB" php artisan migrate --force --no-interaction

TMP_DUMP="$(mktemp)"
trap 'rm -f "$TMP_DUMP"; $MYSQL_CLI -e "DROP DATABASE IF EXISTS \`$SCRATCH_DB\`;"' EXIT

$MYSQLDUMP_CLI --no-data --skip-comments "$SCRATCH_DB" > "$TMP_DUMP"

# email_quotas reset dates default to the migrate run date (dynamic by design)
# — normalize so they never register as drift.
normalize() {
    sed -E "s/(\`(day|month)_reset_at\` date NOT NULL DEFAULT ')[0-9-]+'/\1<MIGRATE-DATE>'/"
}

if diff -u <(normalize < "$BASELINE") <(normalize < "$TMP_DUMP"); then
    echo "OK: schema matches $BASELINE"
else
    echo ""
    echo "DRIFT: schema differs from $BASELINE (see diff above)."
    echo "If intentional, regenerate the baseline:"
    echo "  cp $TMP_DUMP $BASELINE   # (rerun script first if already cleaned up)"
    exit 1
fi

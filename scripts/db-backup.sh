#!/usr/bin/env bash
# Záloha Watson PostgreSQL (pg_dump z kontejneru) — CC-P0-14 / pilot RPO 15 min.
# Použití:  ./scripts/db-backup.sh [cílový_adresář]   (default ./backups)
# Cron pro pilot (RPO 15 min):  */15 * * * *  cd <repo> && ./scripts/db-backup.sh
set -euo pipefail
DIR="${1:-backups}"
mkdir -p "$DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$DIR/watson-$STAMP.sql.gz"
docker exec watson-postgres pg_dump -U watson -d watson --no-owner | gzip > "$OUT"
# retence: drž posledních 96 záloh (24 h při 15min intervalu)
ls -1t "$DIR"/watson-*.sql.gz 2>/dev/null | tail -n +97 | xargs rm -f 2>/dev/null || true
echo "$OUT ($(du -h "$OUT" | cut -f1))"

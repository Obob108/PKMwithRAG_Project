#!/usr/bin/env bash
# Sao luu CSDL PostgreSQL (trong Docker) + anh/PDF trong data/uploads. Dung tren VPS (Linux).
#   bash backend/scripts/backup.sh                 # chay tay, tu bat ky dau
#   crontab -e  ->  15 3 * * * bash /duong/dan/FG-starter/backend/scripts/backup.sh >> /var/log/pkm-backup.log 2>&1
# Bien moi truong (tuy chon): BACKUP_DIR (mac dinh backups/), KEEP_DAYS (mac dinh 14), PG_USER, PG_DB.
# Khoi phuc:
#   docker compose exec -T db pg_restore -U pkm -d pkm --clean --if-exists < backups/pkm-YYYYmmdd-HHMMSS.dump
#   tar -xzf backups/uploads-YYYYmmdd-HHMMSS.tar.gz -C data
set -euo pipefail
cd "$(dirname "$0")/../.."                      # thu muc goc du an (co docker-compose.yml)
DEST="${BACKUP_DIR:-backups}"
KEEP_DAYS="${KEEP_DAYS:-14}"
PG_USER="${PG_USER:-pkm}"
PG_DB="${PG_DB:-pkm}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST"

# pg_dump dinh dang custom (-Fc): nen san, khoi phuc chon loc duoc. Ghi ra file tam roi doi ten:
# loi giua chung khong de lai ban sao luu dang do.
docker compose exec -T db pg_dump -U "$PG_USER" -d "$PG_DB" -Fc > "$DEST/.pkm-$STAMP.tmp"
mv "$DEST/.pkm-$STAMP.tmp" "$DEST/pkm-$STAMP.dump"

if [ -d data/uploads ]; then
  tar -czf "$DEST/uploads-$STAMP.tar.gz" -C data uploads
fi

# Giu KEEP_DAYS ngay gan nhat
find "$DEST" -maxdepth 1 -type f \( -name 'pkm-*.dump' -o -name 'uploads-*.tar.gz' \) -mtime +"$KEEP_DAYS" -delete
echo "$(date '+%F %T') Da sao luu: $DEST/pkm-$STAMP.dump ($(du -h "$DEST/pkm-$STAMP.dump" | cut -f1))"

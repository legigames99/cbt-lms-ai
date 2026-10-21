#!/usr/bin/env bash
# ============================================================================
# Skrip Backup Otomatis CBT & LMS Terintegrasi AI
# Menjalankan backup Redis AOF/RDB & PostgreSQL terkompresi zstd ke Cloudflare R2
# ============================================================================
set -euo pipefail

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="/var/backups/cbt"
R2_REMOTE="r2:cbt-school-backups"
RETENTION_DAYS=14

mkdir -p "${BACKUP_DIR}/pg" "${BACKUP_DIR}/redis"

echo "[${TIMESTAMP}] Memulai proses backup hemat CPU/IO (nice/ionice)..."

# 1. Trigger Redis Background Save
if command -v redis-cli &> /dev/null; then
    redis-cli BGSAVE || true
    sleep 3
    if [ -f /var/lib/redis/dump.rdb ]; then
        cp /var/lib/redis/dump.rdb "${BACKUP_DIR}/redis/dump_${TIMESTAMP}.rdb"
        if command -v zstd &> /dev/null; then
            zstd -q -3 --rm "${BACKUP_DIR}/redis/dump_${TIMESTAMP}.rdb"
        fi
    fi
fi

# 2. Backup PostgreSQL dengan kompresi Zstandard (Hemat CPU)
if command -v pg_dump &> /dev/null; then
    if command -v zstd &> /dev/null; then
        nice -n 19 ionice -c 3 pg_dump -U cbt_user -h 127.0.0.1 -Fc cbt_lms_db | zstd -q -3 > "${BACKUP_DIR}/pg/cbt_lms_db_${TIMESTAMP}.dump.zst"
    else
        nice -n 19 ionice -c 3 pg_dump -U cbt_user -h 127.0.0.1 -Fc cbt_lms_db > "${BACKUP_DIR}/pg/cbt_lms_db_${TIMESTAMP}.dump"
    fi
fi

# 3. Upload ke Cloudflare R2 menggunakan rclone (Limit bandwidth 10MB/s)
if command -v rclone &> /dev/null; then
    rclone copy "${BACKUP_DIR}/pg/" "${R2_REMOTE}/postgres/" --bwlimit 10M || true
    rclone copy "${BACKUP_DIR}/redis/" "${R2_REMOTE}/redis/" --bwlimit 10M || true
fi

# 4. Bersihkan file lokal yang lebih tua dari batas retensi
find "${BACKUP_DIR}" -type f -mtime +${RETENTION_DAYS} -delete 2>/dev/null || true

echo "[$(date +"%Y%m%d_%H%M%S")] Backup selesai."

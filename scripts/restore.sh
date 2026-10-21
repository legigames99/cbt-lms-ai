#!/usr/bin/env bash
# ============================================================================
# Skrip Disaster Recovery & Restore CBT & LMS
# ============================================================================
set -euo pipefail

BACKUP_FILE="${1:-}"

if [ -z "${BACKUP_FILE}" ]; then
    echo "Penggunaan: $0 /path/ke/file_backup.dump.zst"
    exit 1
fi

echo "PERINGATAN: Tindakan ini akan menimpa database 'cbt_lms_db'!"
read -p "Apakah Anda yakin ingin melanjutkan? (y/N): " CONFIRM
if [[ "${CONFIRM}" != "y" && "${CONFIRM}" != "Y" ]]; then
    echo "Restore dibatalkan."
    exit 0
fi

# 1. Hentikan sementara backend
echo "Menghentikan layanan cbt-backend..."
sudo systemctl stop cbt-backend || true

# 2. Dekompresi file backup
TEMP_DUMP="/tmp/cbt_restore_$(date +%s).dump"
echo "Mendekompresi ${BACKUP_FILE} ke ${TEMP_DUMP}..."
zstd -d "${BACKUP_FILE}" -o "${TEMP_DUMP}"

# 3. Reset database
echo "Menyiapkan database PostgreSQL bersih..."
sudo -u postgres psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'cbt_lms_db';" || true
sudo -u postgres psql -c "DROP DATABASE IF EXISTS cbt_lms_db;"
sudo -u postgres psql -c "CREATE DATABASE cbt_lms_db OWNER cbt_user;"

# 4. Restore database dengan 2 core paralel
echo "Menjalankan pg_restore..."
pg_restore -U cbt_user -h 127.0.0.1 -d cbt_lms_db -j 2 "${TEMP_DUMP}"

# 5. Bersihkan file sementara
rm -f "${TEMP_DUMP}"

# 6. Nyalakan kembali backend
echo "Menyalakan kembali layanan cbt-backend..."
sudo systemctl start cbt-backend

echo "Proses restore selesai. Silakan verifikasi sistem."

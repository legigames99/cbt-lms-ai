# Strategi Backup & Perlindungan Data (Zero-Data-Loss)
## Sistem CBT & LMS pada Server 4 Core / 4GB RAM

Karena spesifikasi server terbatas pada 4 Core CPU dan 4GB RAM, proses backup **tidak boleh** membebani CPU atau disk I/O saat jam ujian berlangsung. Strategi backup dibagi menjadi **3 lapis pertahanan**.

---

### 1. Tiga Lapis Pertahanan Data Ujian
1. **Lapis 1 (Browser Siswa - Client Storage):** Setiap jawaban siswa disimpan di `IndexedDB` dan `localStorage` pada browser perangkat masing-masing.
2. **Lapis 2 (Redis Persistence - AOF + RDB):** Setiap jawaban yang masuk ke Redis langsung ditulis ke disk secara *append-only* (`appendfsync everysec`).
3. **Lapis 3 (PostgreSQL + Offsite Cloud Storage):** Sinkronisasi *batch* setiap 20 detik ke PostgreSQL, diikuti pencadangan terkompresi ke **Cloudflare R2 / AWS S3**.

---

### 2. Konfigurasi Persistensi Redis (Saat Ujian)
Pastikan konfigurasi `/etc/redis/redis.conf` mengaktifkan mode hibrida AOF + RDB:
```ini
appendonly yes
appendfilename "appendonly.aof"
appendfsync everysec
aof-use-rdb-preamble yes
save 900 1
save 300 100
```
*Catatan:* `appendfsync everysec` menjamin bahwa jika listrik server mati mendadak, maksimal data yang hilang di sisi Redis hanya 1 detik terakhir, dan data tersebut pun akan dikirim ulang otomatis oleh browser siswa saat server menyala kembali.

---

### 3. Jadwal Backup Otomatis (Cronjob)

| Jenis Backup | Frekuensi | Waktu Eksekusi | Target Penyimpanan |
| :--- | :--- | :--- | :--- |
| **Snapshot Redis (`BGSAVE`)** | Setiap 30 menit (Saat jam ujian) | Menit ke-0 dan ke-30 | Lokal `/var/backups/cbt/redis/` + Sync R2 |
| **Database PostgreSQL (`pg_dump`)** | Setiap selesai sesi ujian & Tengah Malam | Pukul 12:30, 16:00, dan 01:00 WIB | Lokal `/var/backups/cbt/pg/` + Cloudflare R2 |
| **Paket Soal Statis & Konfigurasi** | Harian | Pukul 02:00 WIB | Cloudflare R2 (`rclone`) |

---

### 4. Skrip Otomatisasi Backup (`/opt/cbt/scripts/backup.sh`)

```bash
#!/usr/bin/env bash
set -euo pipefail

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_DIR="/var/backups/cbt"
R2_REMOTE="r2:cbt-school-backups"
RETENTION_DAYS=14

mkdir -p "${BACKUP_DIR}/pg" "${BACKUP_DIR}/redis"

echo "[${TIMESTAMP}] Memulai proses backup dengan prioritas CPU/IO rendah (nice/ionice)..."

# 1. Trigger Redis Background Save
redis-cli BGSAVE
sleep 3
cp /var/lib/redis/dump.rdb "${BACKUP_DIR}/redis/dump_${TIMESTAMP}.rdb"
zstd -q -3 --rm "${BACKUP_DIR}/redis/dump_${TIMESTAMP}.rdb"

# 2. Backup PostgreSQL dengan kompresi Zstandard (Hemat CPU dibanding Gzip)
nice -n 19 ionice -c 3 pg_dump -U cbt_user -h 127.0.0.1 -Fc cbt_lms_db     | zstd -q -3 > "${BACKUP_DIR}/pg/cbt_lms_db_${TIMESTAMP}.dump.zst"

# 3. Upload ke Cloudflare R2 menggunakan rclone (Limit bandwidth agar tidak mengganggu jaringan)
rclone copy "${BACKUP_DIR}/pg/cbt_lms_db_${TIMESTAMP}.dump.zst" "${R2_REMOTE}/postgres/" --bwlimit 10M
rclone copy "${BACKUP_DIR}/redis/dump_${TIMESTAMP}.rdb.zst" "${R2_REMOTE}/redis/" --bwlimit 10M

# 4. Bersihkan file lokal yang lebih tua dari 14 hari
find "${BACKUP_DIR}" -type f -mtime +${RETENTION_DAYS} -delete

echo "[$(date +"%Y%m%d_%H%M%S")] Backup selesai dengan sukses."
```

### 5. Pemasangan Cronjob
Tambahkan ke `crontab -e` milik user `root` atau `cbtadmin`:
```cron
# Backup ringan Redis setiap 30 menit pada jam sekolah (07:00 - 16:00)
*/30 7-16 * * 1-6 /usr/bin/redis-cli BGSAVE > /dev/null 2>&1

# Backup penuh PostgreSQL + Upload ke Cloud setiap jam 12:30, 16:30, dan 01:00
30 12,16 * * 1-6 /opt/cbt/scripts/backup.sh >> /var/log/cbt/backup.log 2>&1
0 1 * * * /opt/cbt/scripts/backup.sh >> /var/log/cbt/backup.log 2>&1
```

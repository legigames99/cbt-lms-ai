# Prosedur Disaster Recovery & Restore
## Panduan Pemulihan Cepat Sistem CBT & LMS

Dokumen ini berisi langkah operasional standar (SOP) untuk memulihkan sistem apabila terjadi kegagalan layanan, kerusakan database, atau perpindahan server darurat saat ujian berlangsung.

---

### 1. Target Waktu Pemulihan (RTO & RPO)
* **RTO (Recovery Time Objective):** < 10 menit untuk kembali online melayani siswa.
* **RPO (Recovery Point Objective):** 0 kehilangan jawaban (karena sinkronisasi berlapis antara `IndexedDB` di browser siswa, Redis AOF, dan PostgreSQL).

---

### 2. Skenario 1: Server Restart Mendadak Saat Ujian Berlangsung
Jika VPS mengalami *reboot* ketika 1.700 siswa sedang mengerjakan ujian:

1. **Verifikasi Layanan Otomatis Menyala:**
   ```bash
   systemctl status postgresql redis-server cbt-backend nginx
   ```
2. **Cek Integritas Data Redis:**
   Redis secara otomatis memuat file `appendonly.aof` saat *booting*. Periksa jumlah kunci sesi jawaban yang aktif:
   ```bash
   redis-cli KEYS "cbt:ans:*" | wc -l
   ```
3. **Picu Sinkronisasi Paksa Redis ke PostgreSQL:**
   Jalankan perintah CLI internal aplikasi Go untuk memaksa *Batch Worker* menyalin seluruh state jawaban Redis ke PostgreSQL:
   ```bash
   /opt/cbt/bin/cbt-server --cmd=flush-redis-to-pg
   ```
4. **Perilaku di Sisi Siswa:**
   Siswa tidak perlu me-*refresh* halaman. Aplikasi SPA di browser siswa mendeteksi koneksi pulih dan otomatis mengirim ulang jawaban yang belum terkonfirmasi dari `IndexedDB` lokal.

---

### 3. Skenario 2: Restore Database PostgreSQL dari Backup Lokal / Cloud

Jika database PostgreSQL mengalami korupsi data:

#### Langkah 1: Aktifkan Halaman Maintenance di Nginx & Hentikan Backend
```bash
sudo systemctl stop cbt-backend
```

#### Langkah 2: Unduh Backup Terbaru dari Cloudflare R2 (Jika File Lokal Hilang)
```bash
rclone copy r2:cbt-school-backups/postgres/ /var/backups/cbt/pg/ --include "*.dump.zst"
ls -lh /var/backups/cbt/pg/
```

#### Langkah 3: Dekompresi dan Restore ke PostgreSQL
```bash
BACKUP_FILE="/var/backups/cbt/pg/cbt_lms_db_TERBARU.dump.zst"

# Dekompresi file .zst
zstd -d "${BACKUP_FILE}" -o /tmp/restore.dump

# Drop dan buat ulang database bersih
sudo -u postgres psql -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'cbt_lms_db';"
sudo -u postgres psql -c "DROP DATABASE IF EXISTS cbt_lms_db;"
sudo -u postgres psql -c "CREATE DATABASE cbt_lms_db OWNER cbt_user;"

# Jalankan pg_restore dengan 2 core paralel
pg_restore -U cbt_user -h 127.0.0.1 -d cbt_lms_db -j 2 /tmp/restore.dump

# Hapus file sementara
rm -f /tmp/restore.dump
```

---

### 4. Skenario 3: Restore Cache Redis dari File `.rdb.zst`

Jika data Redis terhapus tetapi file backup `.rdb.zst` tersedia:
```bash
sudo systemctl stop redis-server

# Nonaktifkan sementara AOF agar Redis membaca dump.rdb saat start
sudo sed -i 's/appendonly yes/appendonly no/' /etc/redis/redis.conf

# Ekstrak file dump.rdb ke direktori kerja Redis
zstd -d /var/backups/cbt/redis/dump_TERBARU.rdb.zst -o /var/lib/redis/dump.rdb
sudo chown redis:redis /var/lib/redis/dump.rdb

# Nyalakan Redis dan bangun ulang file AOF
sudo systemctl start redis-server
redis-cli BGREWRITEAOF

# Aktifkan kembali appendonly di konfigurasi
sudo sed -i 's/appendonly no/appendonly yes/' /etc/redis/redis.conf
```

---

### 5. Checklist Verifikasi Pasca-Restore
- [ ] Cek koneksi database dengan `/opt/cbt/bin/cbt-server --cmd=healthcheck`.
- [ ] Pastikan jumlah baris pada `core.users` dan `cbt.exam_schedules` sesuai.
- [ ] Nyalakan kembali layanan backend: `sudo systemctl start cbt-backend`.
- [ ] Uji login menggunakan 1 akun uji siswa dan pastikan soal serta jawaban sebelumnya tampil utuh.

# Standar Logging, Audit Ujian & Monitoring Ringan
## Observabilitas Tanpa Membebani RAM 4GB

Hindari penggunaan stack monitoring berat seperti ELK Stack (Elasticsearch/Logstash/Kibana) di dalam server 4GB RAM karena Elasticsearch sendiri membutuhkan minimal 2GB RAM. Gunakan **Structured JSON Logging (`log/slog`)** bawaan Go dan utilitas sistem yang ringan.

---

### 1. Kebijakan Level Log pada Saat Ujian
Selama **Exam Lockdown Mode** aktif:
* Matikan log level `DEBUG` dan `INFO` untuk request sukses rutin (`200 OK` pada `/sync`) di lapisan aplikasi Go agar disk I/O tidak penuh oleh jutaan baris log.
* Hanya catat log aplikasi pada level `WARN` dan `ERROR`, serta **Audit Event** penting (seperti *Start Exam*, *Finish Exam*, *Reset Login*, dan *Indikasi Kecurangan*).

---

### 2. Format Structured JSON Log (`slog`)

Seluruh log ditulis ke `/var/log/cbt/app.json.log` dengan format baris tunggal (NDJSON):

```json
{"time":"2026-10-21T07:45:12.104+07:00","level":"WARN","module":"cbt","event":"tab_switched","schedule_id":12,"student_id":1042,"session_id":88412,"violation_count":2,"ip":"10.10.4.112"}
{"time":"2026-10-21T07:45:20.002+07:00","level":"INFO","module":"cbt_worker","event":"batch_upsert_success","schedule_id":12,"flushed_sessions":418,"duration_ms":34}
{"time":"2026-10-21T08:12:01.519+07:00","level":"ERROR","module":"ai","event":"provider_timeout","job_id":"job_ai_99281a","teacher_id":52,"err":"context deadline exceeded"}
```

---

### 3. Konfigurasi Rotasi Log (`/etc/logrotate.d/cbt-lms`)
Agar disk NVMe tidak penuh oleh file log:
```text
/var/log/cbt/*.log {
    daily
    missingok
    rotate 14
    compress
    compresscmd /usr/bin/zstd
    compressext .zst
    delaycompress
    notifempty
    create 0640 cbtadmin adm
    sharedscripts
    postrotate
        systemctl kill -s USR1 cbt-backend.service >/dev/null 2>&1 || true
    endscript
}
```

---

### 4. Endpoint Monitoring Internal (`/api/v1/system/metrics`)
Backend Go menyediakan endpoint metrik super ringan (< 2 ms) khusus untuk halaman Dashboard Proktor/Admin yang mengambil statistik langsung dari runtime Go dan Redis:
```json
{
  "ram_alloc_mb": 48.2,
  "ram_sys_mb": 112.5,
  "num_goroutines": 142,
  "active_exam_students": 1689,
  "pending_redis_dirty_sessions": 312,
  "last_batch_flush_ms": 28,
  "pg_pool_acquired_conns": 6,
  "pg_pool_max_conns": 80
}
```

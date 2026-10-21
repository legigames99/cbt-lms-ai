# CBT & LMS Terintegrasi AI (High-Concurrency Edition)

Platform **Computer-Based Test (CBT)** dan **Learning Management System (LMS)** modern dengan integrasi **AI Question Generator**, dirancang menggunakan arsitektur *Modular Monolith* dan *Local-First Exam Engine* untuk melayani **1.700 siswa secara bersamaan (concurrent)** hanya di atas spesifikasi server **4 Core CPU dan 4GB RAM**.

---

## Keunggulan Arsitektur Utama

1. **Ultra-Lightweight Backend (Golang):** Menggunakan *native binary* Go dengan pemakaian RAM *idle* < 50 MB dan kemampuan menangani ribuan koneksi paralel.
2. **Local-First & Zero-Latency Exam Navigation:** Paket soal dienkripsi AES-256-GCM dan diunduh ke `IndexedDB` browser siswa di ruang tunggu. Saat ujian dimulai, server hanya mengirimkan kunci dekripsi (< 1 KB) sehingga perpindahan nomor soal berlangsung 100% lokal di browser tanpa membebani server.
3. **Write-Behind Caching (Redis + Batch Worker):** Jawaban siswa ditampung di Redis (`HSET`) dengan *Client-Side Jitter* dalam hitungan < 2 milidetik, kemudian disimpan secara massal (*Bulk Upsert*) ke PostgreSQL setiap 20 detik.
4. **AI Question & Rubric Generator:** Mengubah materi pembelajaran di LMS menjadi bank soal pilihan ganda maupun esai secara otomatis menggunakan *Structured JSON Schema* dari Gemini / OpenAI API.
5. **Direct-to-Cloud LMS Storage:** Unggah materi PDF dan pengumpulan tugas siswa langsung diarahkan ke Cloudflare R2 / AWS S3 melalui *Presigned URL* tanpa membebani RAM dan disk server.
6. **Exam Lockdown Mode:** Sakelar otomatis untuk membekukan fitur berat LMS selama jam ujian serentak berlangsung.

---

## Daftar Dokumen Cetak Biru (Blueprint Documentation)

Seluruh spesifikasi teknis proyek ini terdokumentasi di dalam 11 file berikut:

| Nama File | Deskripsi Dokumen |
| :--- | :--- |
| [`prd.md`](./prd.md) | **Product Requirements Document:** Target pengguna, daftar fitur CBT/LMS/AI, dan SLA performa. |
| [`design.md`](./design.md) | **Desain Sistem & Arsitektur:** Struktur direktori Go *Modular Monolith*, alur enkripsi AES-GCM, dan skema JSON AI. |
| [`database.md`](./database.md) | **Skema Database & Cache:** DDL SQL PostgreSQL Multi-Schema (`core`, `lms`, `cbt`) dan struktur key-value Redis. |
| [`api.md`](./api.md) | **Spesifikasi API:** Kontrak endpoint REST & SSE untuk Auth, Pre-fetch ujian, Sync jawaban, dan AI Generator. |
| [`requirements.md`](./requirements.md) | **Kebutuhan Sistem & Tuning:** Alokasi anggaran RAM 4GB serta konfigurasi `postgresql.conf`, `redis.conf`, dan `nginx.conf`. |
| [`backup.md`](./backup.md) | **Strategi Backup:** Pencadangan 3 lapis (IndexedDB, Redis AOF/RDB, PostgreSQL + Cloudflare R2) dengan kompresi `zstd`. |
| [`restore.md`](./restore.md) | **Prosedur Disaster Recovery:** SOP pemulihan cepat (< 10 menit) saat terjadi gangguan di tengah ujian. |
| [`log.md`](./log.md) | **Standar Logging & Audit:** Konfigurasi *Structured JSON Logging* (`slog`), deteksi kecurangan, dan rotasi log. |
| [`roadmap.md`](./roadmap.md) | **Peta Jalan Pengembangan:** Tahapan implementasi 12 minggu dari Fase 1 (Mesin CBT) hingga Fase 4 (Uji Beban k6 1.700 VU). |
| [`pushgithub.md`](./pushgithub.md) | **Panduan Git & CI/CD:** Konfigurasi `.gitignore`, konvensi *commit*, dan GitHub Actions untuk *auto-deploy* binary ke VPS. |
| [`readme.md`](./readme.md) | **Dokumentasi Utama:** Ringkasan proyek, indeks dokumen, dan panduan memulai cepat. |

---

## Panduan Memulai Cepat (Quick Start Development)

### 1. Persiapan Database & Redis
```bash
# Buat database PostgreSQL dan jalankan migrasi skema (core, lms, cbt)
psql -U postgres -c "CREATE DATABASE cbt_lms_db;"
psql -U postgres -d cbt_lms_db -f migrations/001_init_schemas.sql
```

### 2. Konfigurasi Environment (`.env`)
```env
APP_PORT=8080
GOMEMLIMIT=250MiB
DB_DSN=postgres://cbt_user:secret@127.0.0.1:5432/cbt_lms_db?pool_max_conns=80
REDIS_ADDR=127.0.0.1:6379
JWT_SECRET=ganti_dengan_kunci_rahasia_32_karakter
AI_API_KEY=your_gemini_or_openai_api_key
R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
```

### 3. Jalankan Server Backend Go
```bash
go run ./cmd/server/main.go
```

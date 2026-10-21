# Dokumen Desain Sistem & Arsitektur Teknis
## Modular Monolith, Local-First Exam Engine & AI Pipeline

### 1. Struktur Direktori Proyek (Go Modular Monolith)

```text
cbt-lms-ai/
├── cmd/
│   └── server/
│       └── main.go              # Entrypoint tunggal aplikasi + Background Workers
├── internal/
│   ├── config/                  # Konfigurasi environment & RAM limit
│   ├── platform/
│   │   ├── database/            # Koneksi pgxpool (PostgreSQL)
│   │   ├── cache/               # Koneksi go-redis
│   │   ├── storage/             # Presigned URL generator (Cloudflare R2 / S3)
│   │   └── middleware/          # JWT Auth, Rate Limiter, Exam Lockdown Guard
│   ├── core/                    # Modul Pengguna, Kelas, Tahun Ajaran, SSO
│   ├── cbt/                     # Modul Mesin Ujian
│   │   ├── handler.go           # Endpoint ringan (/start, /sync, /finish)
│   │   ├── packager.go          # Compiler soal DB -> JSON Statis Terenkripsi AES-GCM
│   │   └── batch_worker.go      # Goroutine penyalin Redis HSET -> Postgres Bulk Upsert
│   ├── lms/                     # Modul Materi, Tugas, Absensi, Buku Nilai
│   └── ai/                      # Modul AI Question Generator & Essay Grader
│       ├── prompt_builder.go    # Penyusun prompt kurikulum & kognitif Bloom
│       ├── schema.go            # JSON Schema strict untuk output AI
│       └── queue_worker.go      # Worker asinkron pemanggil API Gemini/OpenAI
├── migrations/                  # File migrasi SQL (001_init.sql, dst.)
├── web/                         # Source code Frontend SPA (SvelteKit / Vue 3)
└── scripts/                     # Skrip backup.sh, restore.sh, dan loadtest_k6.js
```

---

### 2. Desain Enkripsi & Dekripsi Paket Soal (Local-First)

Untuk menghindari 1.700 siswa meminta soal ke database saat ujian dimulai:
1. **Saat Guru Mengunci Jadwal Ujian (`packager.go`):**
   - Sistem mengambil daftar soal dari tabel `cbt.questions` (**tanpa menyertakan kolom `correct_answer` dan `explanation_html`** agar siswa tidak bisa mengintip kunci jawaban melalui *Inspect Element*).
   - Data soal diserialisasi menjadi JSON, dikompresi, lalu dienkripsi menggunakan **AES-256-GCM** dengan kunci acak 32-byte (`encryption_key_hex`).
   - File disimpan di `/var/www/cbt/static/packages/exam_{id}_enc.json`.
2. **Saat Siswa di Ruang Tunggu (H-10 Menit):**
   - Browser mengunduh file `exam_{id}_enc.json` melalui Nginx dan menyimpannya ke `IndexedDB`.
3. **Saat Detik Ujian Dimulai (H-0):**
   - Browser memanggil `POST /api/v1/cbt/schedules/{id}/start` dan menerima `decryption_key_hex` (64 karakter hex).
   - Browser mendekripsi soal menggunakan **Web Crypto API (`window.crypto.subtle.decrypt`)** langsung di memori dan merender seluruh nomor soal secara instan.

---

### 3. Algoritma Pengacakan Deterministik di Sisi Klien (Seeded Shuffle)

Karena seluruh 1.700 siswa mengunduh **1 file JSON paket soal yang sama**, pengacakan nomor soal dan urutan opsi jawaban (A/B/C/D/E) dilakukan di browser menggunakan algoritma **Fisher-Yates Shuffle** dengan *seed* berupa gabungan `schedule_id + student_id`:
* Siswa A dan Siswa B yang duduk bersebelahan akan melihat urutan nomor soal dan posisi opsi jawaban yang berbeda.
* Jika Siswa A me-*refresh* browser atau ganti HP, urutan soalnya tetap konsisten karena *seed* yang digunakan sama.

---

### 4. Desain Skema Output JSON untuk AI Question Generator

Saat memanggil API AI (Gemini / OpenAI), sistem memaksa respons mengikuti skema JSON berikut agar dapat langsung disimpan ke tabel `cbt.questions`:

```json
{
  "type": "object",
  "properties": {
    "questions": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "cognitive_level": { "type": "string", "enum": ["C1", "C2", "C3", "C4", "C5", "C6"] },
          "stem_html": { "type": "string" },
          "options": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "id": { "type": "string", "enum": ["A", "B", "C", "D", "E"] },
                "text": { "type": "string" }
              },
              "required": ["id", "text"]
            }
          },
          "correct_answer": { "type": "string", "enum": ["A", "B", "C", "D", "E"] },
          "explanation_html": { "type": "string" }
        },
        "required": ["cognitive_level", "stem_html", "options", "correct_answer", "explanation_html"]
      }
    }
  },
  "required": ["questions"]
}
```

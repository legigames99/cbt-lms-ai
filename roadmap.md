# Peta Jalan Pengembangan (Project Roadmap)
## Sistem CBT & LMS Terintegrasi AI

Pengembangan dibagi menjadi **4 Fase Terukur (12 Minggu)** dengan prinsip mendahulukan mesin inti berkonkurensi tinggi (CBT) sebelum memperluas fitur pembelajaran harian (LMS).

---

### Fase 1: Fondasi Core & Mesin Ujian High-Concurrency (Minggu 1–3)
**Target:** Sistem mampu menjalankan ujian pilihan ganda untuk 1.700 siswa secara simulasi dengan beban RAM < 2 GB.
- [ ] Inisialisasi struktur proyek Go *Modular Monolith* (`internal/core`, `internal/cbt`, `internal/lms`, `internal/ai`).
- [ ] Pembuatan migrasi database PostgreSQL multi-schema (`core`, `lms`, `cbt`).
- [ ] Implementasi autentikasi SSO berbasis JWT Stateless dan manajemen sesi Redis.
- [ ] Pembuatan **Exam Packager**: Mengubah bank soal di PostgreSQL menjadi file JSON statis terenkripsi AES-256-GCM.
- [ ] Pembangunan Frontend Siswa (SPA) dengan penyimpanan lokal `IndexedDB` (Dexie.js), *Pre-Fetch* di ruang tunggu, dan dekripsi di memori browser.
- [ ] Implementasi endpoint sinkronisasi jawaban ke Redis (`HSET`) dengan *Client-Side Debounce & Random Jitter*.
- [ ] Pembuatan **Background Batch Worker** di Go untuk melakukan *Bulk Upsert* dari Redis ke PostgreSQL setiap 20 detik.

---

### Fase 2: Integrasi AI Generator & Koreksi Otomatis (Minggu 4–6)
**Target:** Guru dapat menghasilkan 40 soal terstruktur dari teks materi kurang dari 30 detik.
- [ ] Integrasi SDK/HTTP Client ke Gemini API / OpenAI API menggunakan fitur **Structured Outputs (JSON Schema)**.
- [ ] Pembuatan sistem antrean (*Background Job Queue*) berbasis Redis untuk memproses pembuatan soal secara asinkron.
- [ ] Implementasi *Server-Sent Events (SSE)* untuk menampilkan progres pembuatan soal secara *real-time* di layar guru.
- [ ] Fitur editor bank soal (tinjau, revisi, dan setujui soal hasil buatan AI).
- [ ] Pembuatan worker penilai jawaban esai otomatis berbantuan AI (dijalankan di luar jam ujian puncak).

---

### Fase 3: Ekspansi Modul LMS & Sakelar Lockdown (Minggu 7–9)
**Target:** Guru dan siswa dapat melakukan kegiatan belajar harian tanpa membebani penyimpanan lokal server.
- [ ] Integrasi *Object Storage* (Cloudflare R2 / S3) dengan mekanisme *Presigned URL* untuk unggah materi PDF dan tugas siswa.
- [ ] Pembuatan modul kelas, jadwal pelajaran, materi harian (teks + embed video), dan pengumpulan tugas.
- [ ] Integrasi satu klik: **"Buat Soal Ujian CBT dari Materi LMS Ini"**.
- [ ] Pembangunan **Unified Gradebook** (rekap nilai gabungan tugas LMS dan ujian CBT).
- [ ] Implementasi **Exam Lockdown Mode** (Middleware Go untuk memblokir fitur berat LMS saat jam ujian berlangsung).

---

### Fase 4: Load Testing 1.700 VU, Hardening & Go-Live (Minggu 10–12)
**Target:** Lulus uji beban 1.700 *Virtual Users (VU)* serentak di atas VPS 4 Core / 4GB RAM sesungguhnya.
- [ ] Penulisan skrip uji beban menggunakan **Grafana k6** yang mensimulasikan:
  - 1.700 siswa *login* dalam rentang 60 detik.
  - 1.700 siswa mengunduh paket soal dan mengambil kunci dekripsi di detik yang sama.
  - 1.700 siswa mengirim jawaban selama 60 menit dan menekan tombol *Selesai*.
- [ ] Tuning parameter `postgresql.conf`, `redis.conf`, `nginx.conf`, dan `GOMEMLIMIT` berdasarkan hasil uji k6.
- [ ] Uji coba skenario *Disaster Recovery* (mematikan paksa layanan saat ujian berjalan dan memverifikasi 0 kehilangan data).
- [ ] Pelatihan proktor/guru dan peluncuran produksi (*Go-Live*).

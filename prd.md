# Product Requirements Document (PRD)
## Sistem CBT & LMS Terintegrasi AI (High-Concurrency Edition)

### 1. Ringkasan Eksekutif
Proyek ini bertujuan membangun platform **Computer-Based Test (CBT)** yang terintegrasi dengan **Learning Management System (LMS)** serta **Generator Soal Berbasis AI**. Sistem dirancang khusus dengan arsitektur *Modular Monolith* dan *Local-First* agar mampu melayani **1.700 siswa secara bersamaan (concurrent)** hanya dengan menggunakan spesifikasi server **4 Core CPU dan 4GB RAM**.

---

### 2. Tujuan & Sasaran Produk
1. **Efisiensi Infrastruktur Ekstrem:** Menjalankan ujian serentak 1.700 siswa tanpa *downtime* atau *Out-Of-Memory (OOM)* pada VPS 4 Core / 4GB RAM.
2. **Otomatisasi Pembuatan Soal dengan AI:** Memungkinkan guru mengubah materi pembelajaran di LMS (PDF/Teks) menjadi paket soal pilihan ganda dan esai berstandar Kurikulum Merdeka/K13 dalam hitungan detik.
3. **Zero-Latency Navigation:** Perpindahan antar nomor soal terjadi secara instan (< 10 ms) di sisi browser siswa menggunakan strategi *Pre-Fetch* dan *IndexedDB*.
4. **Keamanan & Integritas Ujian:** Paket soal dienkripsi AES-256-GCM sebelum waktu ujian dimulai dan dibuka serentak menggunakan kunci dekripsi ringan (< 1 KB).

---

### 3. Target Pengguna (User Personas)
* **Siswa (1.700 Pengguna Aktif Serentak):** Mengakses materi harian di LMS dan mengerjakan ujian di CBT melalui perangkat HP Android/iOS maupun laptop sekolah.
* **Guru (50–100 Pengguna):** Mengunggah materi, memberikan tugas, menghasilkan soal otomatis dengan AI, dan memantau nilai.
* **Pengawas Ujian (Proktor):** Memantau status kehadiran siswa saat ujian, mereset sesi *login* perangkat, dan mengawasi log indikasi kecurangan.
* **Administrator Sistem:** Mengelola data master (kelas, siswa, tahun ajaran) dan mengaktifkan sakelar **Exam Lockdown Mode**.

---

### 4. Fitur Utama (Functional Requirements)

#### A. Modul CBT (Mesin Ujian)
1. **Pre-Fetch Paket Soal Terenkripsi:** 10 menit sebelum ujian dimulai (di halaman ruang tunggu), browser siswa mengunduh file JSON soal terenkripsi dari Nginx dan menyimpannya di `IndexedDB`.
2. **Buka Kunci Serentak:** Saat waktu ujian tiba, server mengirimkan kunci dekripsi ukuran mikro (< 1 KB).
3. **Sinkronisasi Jawaban Berbasis Jitter & Redis Buffer:**
   - Jawaban disimpan instan di `localStorage`/`IndexedDB` siswa.
   - Pengiriman jawaban ke server menggunakan *debounce* (3 detik) dan *random jitter* (sinkronisasi latar belakang setiap 20–40 detik) menuju Redis (`HSET`).
4. **Anti-Cheat & Lock Browser:** Mendeteksi aktivitas keluar tab/jendela (*blur/visibilitychange*), mengacak urutan soal dan opsi jawaban di sisi klien berdasarkan *seed* ID siswa.

#### B. Modul AI Question & Rubric Generator
1. **Konversi Materi LMS ke Bank Soal:** Guru memilih bab materi di LMS, menentukan jumlah soal, tingkat kesulitan (C1–C6 Taksonomi Bloom), dan memicu AI untuk menghasilkan soal berformat JSON Schema baku.
2. **Asisten Koreksi Esai:** Memberikan rekomendasi skor dan umpan balik otomatis untuk jawaban uraian siswa di luar jam ujian puncak.

#### C. Modul LMS (Pembelajaran Harian)
1. **Manajemen Materi & Tugas Direct-to-Cloud:** Unggah file materi (PDF/PPT) dan pengumpulan tugas siswa langsung menuju *Object Storage* (Cloudflare R2 / S3) menggunakan *Presigned URL* tanpa membebani RAM server.
2. **Buku Nilai Terpadu (Unified Gradebook):** Menggabungkan nilai tugas harian LMS dengan nilai kuis/UTS/UAS dari CBT secara otomatis.

#### D. Fitur "Exam Lockdown Mode"
1. Sakelar satu klik di dashboard Admin untuk menonaktifkan sementara fitur LMS yang berat (upload tugas, forum, generator AI, cetak rapor) selama jam ujian berlangsung agar 100% resource server fokus pada CBT.

---

### 5. Kebutuhan Non-Fungsional (SLA & Performa)
* **Kapasitas Konkurensi:** Minimal 1.700 siswa aktif bersamaan saat detik *Start Exam* dan *Submit Exam*.
* **Batas Penggunaan RAM Server:** Maksimal 2,8 GB dari total 4 GB pada beban puncak (menyisakan ~1,2 GB untuk OS Page Cache).
* **Response Time API:**
  - Simpan jawaban ke Redis (`POST /api/v1/cbt/answer`): `p99 < 15 ms`.
  - Ambil kunci dekripsi (`GET /api/v1/cbt/exam/:id/key`): `p99 < 25 ms`.
* **Ketersediaan Data (Zero Data Loss):** Jawaban tetap tersimpan di `IndexedDB` browser siswa meskipun koneksi internet sekolah terputus sementara, dan otomatis tersinkronisasi saat koneksi pulih.

# Spesifikasi API (REST & Server-Sent Events)
## Sistem CBT & LMS Terintegrasi AI

Seluruh endpoint API menggunakan format JSON dengan *base path* `/api/v1`. Autentikasi menggunakan **Stateless JWT (EdDSA / HS256)** yang disimpan di `HttpOnly Cookie` atau header `Authorization: Bearer <token>` sehingga server tidak perlu melakukan *query* database untuk memvalidasi setiap *request*.

---

### 1. Endpoint Autentikasi (`core`)

#### `POST /api/v1/auth/login`
Login tunggal (SSO) untuk Siswa, Guru, Proktor, dan Admin.
* **Request Body:**
  ```json
  {
    "username": "0081234567",
    "password": "PasswordSiswa123",
    "device_fingerprint": "a8f5f167f44f4964e6c998dee827110c"
  }
  ```
* **Response `200 OK`:**
  ```json
  {
    "status": "success",
    "data": {
      "access_token": "eyJhbGciOiJIUzI1NiIsIn...",
      "expires_in": 28800,
      "exam_lockdown_mode": true,
      "user": {
        "id": 1042,
        "full_name": "Budi Santoso",
        "role": "student",
        "class_name": "XII IPA 1"
      }
    }
  }
  ```

---

### 2. Endpoint Mesin Ujian (`cbt`) — High-Concurrency Path

#### A. Ambil Info Ruang Tunggu & URL Paket Soal Terenkripsi
`GET /api/v1/cbt/schedules/active`
* **Response `200 OK`:**
  ```json
  {
    "schedule_id": 12,
    "title": "UAS Matematika Wajib XII",
    "start_time": "2026-10-21T07:30:00+07:00",
    "duration_minutes": 90,
    "package_url": "/static/packages/exam_12_enc.json",
    "package_sha256": "3a7bd3e2360a3d29eea436fcfb7e44c735d117c42d1c1835420b6b9942dd4f1b"
  }
  ```
*Catatan:* File `/static/packages/exam_12_enc.json` dilayani langsung oleh **Nginx** dari memori cache OS tanpa menyentuh aplikasi Go.

#### B. Mulai Ujian & Ambil Kunci Dekripsi (< 1 KB)
`POST /api/v1/cbt/schedules/{schedule_id}/start`
* **Request Body:**
  ```json
  {
    "token_code": "X9K2LP"
  }
  ```
* **Response `200 OK`:**
  ```json
  {
    "session_id": 88412,
    "decryption_key_hex": "603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4",
    "server_time": 1761006600,
    "saved_answers": {
      "101": {"a": "B", "d": 0},
      "102": {"a": "A", "d": 1}
    }
  }
  ```

#### C. Sinkronisasi Jawaban ke Redis Buffer (Ringan & Cepat)
`POST /api/v1/cbt/schedules/{schedule_id}/sync`
Dipanggil oleh browser siswa dengan mekanisme *Debounce (3s)* + *Random Jitter (20–40s)*.
* **Request Body (Ukuran < 300 Bytes):**
  ```json
  {
    "session_id": 88412,
    "answers": {
      "105": {"a": "D", "d": 0, "ts": 1761006812},
      "106": {"a": "C", "d": 1, "ts": 1761006825}
    },
    "violation_delta": 0
  }
  ```
* **Response `200 OK`:**
  ```json
  {
    "ack": true,
    "synced_count": 2,
    "server_ts": 1761006826
  }
  ```

#### D. Selesai Ujian (Final Submit)
`POST /api/v1/cbt/schedules/{schedule_id}/finish`
* **Request Body:** Mengirimkan seluruh snapshot jawaban terakhir dari `IndexedDB` untuk memastikan tidak ada satupun nomor yang terlewat sebelum sesi dikunci.

---

### 3. Endpoint Generator Soal AI (`ai`)

#### A. Buat Job Pembuatan Soal Otomatis dari Materi LMS
`POST /api/v1/ai/generate-questions`
* **Request Body:**
  ```json
  {
    "course_id": 4,
    "material_id": 19,
    "bank_id": 7,
    "question_count": 20,
    "question_type": "mcq",
    "cognitive_distribution": {
      "C2": 5,
      "C3": 10,
      "C4": 5
    },
    "additional_prompt": "Fokuskan pada penerapan hukum termodinamika dalam kehidupan sehari-hari."
  }
  ```
* **Response `202 Accepted`:**
  ```json
  {
    "job_id": "job_ai_99281a",
    "status": "queued",
    "stream_url": "/api/v1/ai/jobs/job_ai_99281a/events"
  }
  ```

#### B. Pantau Progres Pembuatan Soal AI (Server-Sent Events / SSE)
`GET /api/v1/ai/jobs/{job_id}/events`
* **Event Stream:**
  ```text
  event: progress
  data: {"status": "processing", "completed": 10, "total": 20}

  event: completed
  data: {"status": "done", "bank_id": 7, "inserted_count": 20}
  ```

---

### 4. Endpoint LMS & Presigned Upload (`lms`)

#### `POST /api/v1/lms/storage/presign-upload`
Menghasilkan URL unggah langsung ke Cloudflare R2 / S3 agar file tugas siswa tidak melewati RAM 4GB server.
* **Request Body:**
  ```json
  {
    "filename": "tugas_fisika_budi.pdf",
    "content_type": "application/pdf",
    "size_bytes": 2458192
  }
  ```
* **Response `200 OK`:**
  ```json
  {
    "upload_url": "https://school-lms.r2.cloudflarestorage.com/submissions/2026/10/...",
    "object_key": "submissions/2026/10/1042_tugas_fisika_budi.pdf",
    "expires_in": 600
  }
  ```

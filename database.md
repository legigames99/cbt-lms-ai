# Desain Database & Struktur In-Memory Cache
## PostgreSQL Multi-Schema & Redis Key-Value Architecture

Sistem menggunakan **satu instance PostgreSQL 16+** dengan pemisahan **3 Schema (`core`, `lms`, `cbt`)** untuk menjaga isolasi transaksi sekaligus menghemat RAM pada server 4GB.

---

### 1. Arsitektur Skema PostgreSQL

```sql
-- Inisialisasi Schema
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS lms;
CREATE SCHEMA IF NOT EXISTS cbt;
```

#### A. Schema `core` (Autentikasi, Pengguna & Akademik)
```sql
CREATE TABLE core.academic_years (
    id SMALLSERIAL PRIMARY KEY,
    name VARCHAR(20) NOT NULL, -- contoh: "2026/2027"
    is_active BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE core.classes (
    id SERIAL PRIMARY KEY,
    academic_year_id SMALLINT REFERENCES core.academic_years(id),
    name VARCHAR(50) NOT NULL, -- contoh: "XII IPA 1"
    grade_level SMALLINT NOT NULL
);

CREATE TABLE core.users (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL, -- NISN / NIP
    password_hash VARCHAR(255) NOT NULL,  -- Argon2id / Bcrypt
    full_name VARCHAR(120) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'teacher', 'student', 'proctor')),
    class_id INT REFERENCES core.classes(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_username ON core.users(username);
CREATE INDEX idx_users_class_role ON core.users(class_id, role);
```

#### B. Schema `lms` (Pembelajaran Harian & Tugas)
```sql
CREATE TABLE lms.courses (
    id SERIAL PRIMARY KEY,
    academic_year_id SMALLINT REFERENCES core.academic_years(id),
    teacher_id BIGINT REFERENCES core.users(id),
    subject_name VARCHAR(100) NOT NULL,
    grade_level SMALLINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE lms.materials (
    id BIGSERIAL PRIMARY KEY,
    course_id INT REFERENCES lms.courses(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    content_text TEXT, -- Digunakan sebagai konteks sumber AI Question Generator
    attachment_object_key VARCHAR(255), -- Key file di Cloudflare R2 / S3
    video_embed_url VARCHAR(255),
    is_published BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE lms.assignments (
    id BIGSERIAL PRIMARY KEY,
    course_id INT REFERENCES lms.courses(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    instructions TEXT,
    due_date TIMESTAMPTZ NOT NULL,
    max_score NUMERIC(5,2) DEFAULT 100.00,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE lms.submissions (
    id BIGSERIAL PRIMARY KEY,
    assignment_id BIGINT REFERENCES lms.assignments(id) ON DELETE CASCADE,
    student_id BIGINT REFERENCES core.users(id) ON DELETE CASCADE,
    file_object_key VARCHAR(255),
    answer_text TEXT,
    score NUMERIC(5,2),
    ai_feedback TEXT,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (assignment_id, student_id)
);
```

#### C. Schema `cbt` (Bank Soal, Jadwal Ujian, Sesi & Jawaban)
```sql
CREATE TABLE cbt.question_banks (
    id SERIAL PRIMARY KEY,
    course_id INT REFERENCES lms.courses(id),
    teacher_id BIGINT REFERENCES core.users(id),
    title VARCHAR(150) NOT NULL,
    total_questions SMALLINT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE cbt.questions (
    id BIGSERIAL PRIMARY KEY,
    bank_id INT REFERENCES cbt.question_banks(id) ON DELETE CASCADE,
    question_type VARCHAR(15) NOT NULL CHECK (question_type IN ('mcq', 'multi_mcq', 'essay')),
    cognitive_level VARCHAR(5), -- C1 s/d C6
    stem_html TEXT NOT NULL,
    options_json JSONB, -- [{"id":"A","text":"..."},{"id":"B","text":"..."}]
    correct_answer JSONB NOT NULL, -- "A" atau ["A","C"] atau rubrik esai
    explanation_html TEXT,
    score_weight NUMERIC(5,2) DEFAULT 1.00,
    is_ai_generated BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_questions_bank_id ON cbt.questions(bank_id);

CREATE TABLE cbt.exam_schedules (
    id SERIAL PRIMARY KEY,
    bank_id INT REFERENCES cbt.question_banks(id),
    title VARCHAR(150) NOT NULL,
    token_code VARCHAR(10) NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    duration_minutes SMALLINT NOT NULL,
    package_file_path VARCHAR(255), -- Lokasi JSON statis terenkripsi
    encryption_key_hex VARCHAR(64) NOT NULL, -- Kunci AES-256 untuk dekripsi lokal
    shuffle_questions BOOLEAN DEFAULT TRUE,
    shuffle_options BOOLEAN DEFAULT TRUE,
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'ongoing', 'finished'))
);

CREATE TABLE cbt.exam_sessions (
    id BIGSERIAL PRIMARY KEY,
    schedule_id INT REFERENCES cbt.exam_schedules(id) ON DELETE CASCADE,
    student_id BIGINT REFERENCES core.users(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    client_ip VARCHAR(45),
    violation_count SMALLINT DEFAULT 0,
    final_score NUMERIC(5,2),
    status VARCHAR(15) DEFAULT 'waiting' CHECK (status IN ('waiting', 'working', 'submitted')),
    UNIQUE (schedule_id, student_id)
);

-- Tabel penyimpanan permanen hasil Batch Upsert dari Redis
CREATE TABLE cbt.student_answers (
    session_id BIGINT REFERENCES cbt.exam_sessions(id) ON DELETE CASCADE,
    question_id BIGINT REFERENCES cbt.questions(id) ON DELETE CASCADE,
    answer_payload JSONB NOT NULL, -- contoh: {"ans": "B", "doubt": false, "ts": 1730000000}
    is_correct BOOLEAN,
    score_earned NUMERIC(5,2) DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (session_id, question_id)
);
```

---

### 2. Struktur Key-Value Redis (In-Memory Buffer)

Redis dikonfigurasi dengan pemisahan *namespace* agar mudah dikelola dan sangat hemat memori:

| Key Pattern | Tipe Data Redis | Contoh Isi | Fungsi & TTL |
| :--- | :--- | :--- | :--- |
| `sys:lockdown_mode` | `STRING` | `"1"` atau `"0"` | Menandai apakah **Exam Lockdown Mode** sedang aktif. |
| `cbt:key:{schedule_id}` | `STRING` | `"8f9a2b..."` (AES Key) | Cache kunci dekripsi paket soal di RAM agar tidak query ke DB saat 1.700 siswa klik mulai. |
| `cbt:ans:{schedule_id}:{student_id}` | `HASH` | Field: `q_101` -> Value: `{"a":"C","d":0}` | Menyimpan seluruh jawaban siswa secara instan via `HSET`. Memori untuk 1.700 siswa x 50 soal hanya ~12 MB. |
| `cbt:dirty_sessions:{schedule_id}` | `SET` | `1042`, `1088`, `1520` | Daftar `student_id` yang baru saja memperbarui jawaban dan belum disinkronkan ke PostgreSQL oleh *Batch Worker*. |
| `cbt:presence:{schedule_id}` | `ZSET` | Score: `timestamp`, Member: `student_id` | Melacak siswa yang sedang aktif online selama ujian. |
| `ai:queue:jobs` | `LIST / STREAM` | Payload JSON tugas AI | Antrean asinkron pembuatan soal AI agar tidak memblokir koneksi HTTP guru. |

---

### 3. Mekanisme Bulk Upsert (Redis ke PostgreSQL)

Setiap 20 detik, *Background Worker* di Go mengambil anggota dari `cbt:dirty_sessions:{schedule_id}` menggunakan `SPOP`, membaca hash jawaban siswa dengan `HGETALL`, lalu mengeksekusi satu transaksi `INSERT ... ON CONFLICT DO UPDATE` massal ke tabel `cbt.student_answers`:

```sql
INSERT INTO cbt.student_answers (session_id, question_id, answer_payload, updated_at)
SELECT * FROM UNNEST($1::bigint[], $2::bigint[], $3::jsonb[], $4::timestamptz[])
ON CONFLICT (session_id, question_id)
DO UPDATE SET
    answer_payload = EXCLUDED.answer_payload,
    updated_at = EXCLUDED.updated_at;
```

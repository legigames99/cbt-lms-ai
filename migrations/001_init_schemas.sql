-- ============================================================================
-- Migration: 001_init_schemas.sql
-- CBT & LMS Terintegrasi AI (High-Concurrency Edition)
-- PostgreSQL 16+ Multi-Schema: core, lms, cbt
-- ============================================================================

-- Inisialisasi Schema
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS lms;
CREATE SCHEMA IF NOT EXISTS cbt;

-- ============================================================================
-- 1. SCHEMA CORE (Autentikasi, Pengguna & Akademik)
-- ============================================================================

CREATE TABLE IF NOT EXISTS core.academic_years (
    id SMALLSERIAL PRIMARY KEY,
    name VARCHAR(20) NOT NULL, -- contoh: "2026/2027"
    is_active BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS core.classes (
    id SERIAL PRIMARY KEY,
    academic_year_id SMALLINT REFERENCES core.academic_years(id) ON DELETE CASCADE,
    name VARCHAR(50) NOT NULL, -- contoh: "XII IPA 1"
    grade_level SMALLINT NOT NULL
);

CREATE TABLE IF NOT EXISTS core.users (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(50) UNIQUE NOT NULL, -- NISN / NIP / Username
    password_hash VARCHAR(255) NOT NULL,  -- Argon2id / Bcrypt
    full_name VARCHAR(120) NOT NULL,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'teacher', 'student', 'proctor')),
    class_id INT REFERENCES core.classes(id) ON DELETE SET NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_username ON core.users(username);
CREATE INDEX IF NOT EXISTS idx_users_class_role ON core.users(class_id, role);

-- ============================================================================
-- 2. SCHEMA LMS (Mata Pelajaran, Materi & Tugas)
-- ============================================================================

CREATE TABLE IF NOT EXISTS lms.courses (
    id SERIAL PRIMARY KEY,
    academic_year_id SMALLINT REFERENCES core.academic_years(id) ON DELETE CASCADE,
    teacher_id BIGINT REFERENCES core.users(id) ON DELETE RESTRICT,
    subject_name VARCHAR(100) NOT NULL,
    grade_level SMALLINT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lms.materials (
    id BIGSERIAL PRIMARY KEY,
    course_id INT REFERENCES lms.courses(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    content_text TEXT, -- Digunakan sebagai konteks sumber AI Question Generator
    attachment_object_key VARCHAR(255), -- Key file di Cloudflare R2 / S3
    video_embed_url VARCHAR(255),
    is_published BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lms.assignments (
    id BIGSERIAL PRIMARY KEY,
    course_id INT REFERENCES lms.courses(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    instructions TEXT,
    due_date TIMESTAMPTZ NOT NULL,
    max_score NUMERIC(5,2) DEFAULT 100.00,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lms.submissions (
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

-- ============================================================================
-- 3. SCHEMA CBT (Bank Soal, Jadwal Ujian, Sesi & Jawaban)
-- ============================================================================

CREATE TABLE IF NOT EXISTS cbt.question_banks (
    id SERIAL PRIMARY KEY,
    course_id INT REFERENCES lms.courses(id) ON DELETE SET NULL,
    teacher_id BIGINT REFERENCES core.users(id) ON DELETE RESTRICT,
    title VARCHAR(150) NOT NULL,
    total_questions SMALLINT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cbt.questions (
    id BIGSERIAL PRIMARY KEY,
    bank_id INT REFERENCES cbt.question_banks(id) ON DELETE CASCADE,
    question_type VARCHAR(15) NOT NULL CHECK (question_type IN ('mcq', 'multi_mcq', 'essay')),
    cognitive_level VARCHAR(5), -- C1 s/d C6 (Bloom's Taxonomy)
    stem_html TEXT NOT NULL,
    options_json JSONB, -- [{"id":"A","text":"..."},{"id":"B","text":"..."}]
    correct_answer JSONB NOT NULL, -- "A" atau ["A","C"] atau rubrik esai
    explanation_html TEXT,
    score_weight NUMERIC(5,2) DEFAULT 1.00,
    is_ai_generated BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_questions_bank_id ON cbt.questions(bank_id);

CREATE TABLE IF NOT EXISTS cbt.exam_schedules (
    id SERIAL PRIMARY KEY,
    bank_id INT REFERENCES cbt.question_banks(id) ON DELETE RESTRICT,
    title VARCHAR(150) NOT NULL,
    token_code VARCHAR(10) NOT NULL,
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    duration_minutes SMALLINT NOT NULL,
    package_file_path VARCHAR(255), -- Lokasi file JSON statis terenkripsi
    encryption_key_hex VARCHAR(64) NOT NULL, -- Kunci AES-256 untuk dekripsi lokal di browser
    shuffle_questions BOOLEAN DEFAULT TRUE,
    shuffle_options BOOLEAN DEFAULT TRUE,
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'ongoing', 'finished')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cbt.exam_sessions (
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

CREATE INDEX IF NOT EXISTS idx_exam_sessions_schedule_student ON cbt.exam_sessions(schedule_id, student_id);

-- Tabel penyimpanan permanen hasil Bulk Upsert dari Redis
CREATE TABLE IF NOT EXISTS cbt.student_answers (
    session_id BIGINT REFERENCES cbt.exam_sessions(id) ON DELETE CASCADE,
    question_id BIGINT REFERENCES cbt.questions(id) ON DELETE CASCADE,
    answer_payload JSONB NOT NULL, -- contoh: {"ans": "B", "doubt": false, "ts": 1730000000}
    is_correct BOOLEAN,
    score_earned NUMERIC(5,2) DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (session_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_student_answers_session ON cbt.student_answers(session_id);

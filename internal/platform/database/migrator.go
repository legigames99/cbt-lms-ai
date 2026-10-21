package database

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"time"

	"cbt-lms-ai/internal/core"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Migrator struct {
	pool *pgxpool.Pool
}

func NewMigrator(pool *pgxpool.Pool) *Migrator {
	return &Migrator{pool: pool}
}

// AutoMigrate membaca file SQL DDL dan mengeksekusinya
func (m *Migrator) AutoMigrate(ctx context.Context, sqlFilePath string) error {
	sqlBytes, err := os.ReadFile(sqlFilePath)
	if err != nil {
		return fmt.Errorf("gagal membaca file migrasi %s: %w", sqlFilePath, err)
	}

	_, err = m.pool.Exec(ctx, string(sqlBytes))
	if err != nil {
		return fmt.Errorf("eksekusi file migrasi gagal: %w", err)
	}

	slog.Info("Migrasi database berhasil dieksekusi", "file", sqlFilePath)
	return nil
}

// SeedInitialData mengisi data awal jika database masih kosong
func (m *Migrator) SeedInitialData(ctx context.Context) error {
	var count int
	checkQuery := `SELECT COUNT(*) FROM core.users;`
	if err := m.pool.QueryRow(ctx, checkQuery).Scan(&count); err != nil {
		return fmt.Errorf("gagal mengecek data pengguna: %w", err)
	}

	if count > 0 {
		slog.Info("Database sudah memiliki data awal, melewati proses seeding", "user_count", count)
		return nil
	}

	slog.Info("Memulai seeding data master awal...")

	// 1. Tahun Ajaran
	var ayID int16
	err := m.pool.QueryRow(ctx, `
		INSERT INTO core.academic_years (name, is_active)
		VALUES ('2026/2027', TRUE)
		RETURNING id;
	`).Scan(&ayID)
	if err != nil {
		return fmt.Errorf("seed academic year gagal: %w", err)
	}

	// 2. Kelas
	var classID int
	err = m.pool.QueryRow(ctx, `
		INSERT INTO core.classes (academic_year_id, name, grade_level)
		VALUES ($1, 'XII IPA 1', 12)
		RETURNING id;
	`, ayID).Scan(&classID)
	if err != nil {
		return fmt.Errorf("seed class gagal: %w", err)
	}

	// 3. Pengguna Awal (Admin, Guru, Proktor, Siswa)
	adminHash, _ := core.HashPassword("admin123")
	guruHash, _ := core.HashPassword("guru123")
	proktorHash, _ := core.HashPassword("proktor123")
	siswaHash, _ := core.HashPassword("siswa123")

	var adminID, teacherID int64
	_ = m.pool.QueryRow(ctx, `
		INSERT INTO core.users (username, password_hash, full_name, role, is_active)
		VALUES ('admin', $1, 'Administrator Sekolah', 'admin', TRUE)
		RETURNING id;
	`, adminHash).Scan(&adminID)

	_ = m.pool.QueryRow(ctx, `
		INSERT INTO core.users (username, password_hash, full_name, role, is_active)
		VALUES ('guru', $1, 'Drs. Budi Pratama, M.Pd.', 'teacher', TRUE)
		RETURNING id;
	`, guruHash).Scan(&teacherID)

	_, _ = m.pool.Exec(ctx, `
		INSERT INTO core.users (username, password_hash, full_name, role, is_active)
		VALUES ('proktor', $1, 'Proktor Ruang Lab 1', 'proctor', TRUE);
	`, proktorHash)

	// Buat 10 Siswa Contoh
	for i := 1; i <= 10; i++ {
		username := fmt.Sprintf("siswa_%04d", 1000+i)
		fullName := fmt.Sprintf("Siswa Contoh %02d", i)
		_, _ = m.pool.Exec(ctx, `
			INSERT INTO core.users (username, password_hash, full_name, role, class_id, is_active)
			VALUES ($1, $2, $3, 'student', $4, TRUE);
		`, username, siswaHash, fullName, classID)
	}

	// 4. Kursus & Materi LMS
	var courseID int
	_ = m.pool.QueryRow(ctx, `
		INSERT INTO lms.courses (academic_year_id, teacher_id, subject_name, grade_level)
		VALUES ($1, $2, 'Fisika Peminatan XII', 12)
		RETURNING id;
	`, ayID, teacherID).Scan(&courseID)

	var matID int64
	matContent := `Termodinamika adalah cabang fisika yang mempelajari perpindahan kalor dan kerja.
Hukum Pertama Termodinamika merupakan prinsip kekekalan energi: energi total suatu sistem terisolasi selalu konstan.
Rumus dasar: Delta U = Q - W, di mana Delta U adalah perubahan energi dalam, Q adalah kalor yang diterima sistem, dan W adalah kerja yang dilakukan sistem.`

	_ = m.pool.QueryRow(ctx, `
		INSERT INTO lms.materials (course_id, title, content_text, is_published)
		VALUES ($1, 'Hukum Termodinamika & Kekekalan Energi', $2, TRUE)
		RETURNING id;
	`, courseID, matContent).Scan(&matID)

	// 5. CBT Question Bank
	var bankID int
	_ = m.pool.QueryRow(ctx, `
		INSERT INTO cbt.question_banks (course_id, teacher_id, title, total_questions)
		VALUES ($1, $2, 'Bank Soal Ujian Termodinamika Semester Ganjil', 5)
		RETURNING id;
	`, courseID, teacherID).Scan(&bankID)

	// 6. Masukkan 5 Butir Soal Contoh
	sampleQuestions := []struct {
		cogLevel string
		stem     string
		options  string
		answer   string
		exp      string
	}{
		{
			cogLevel: "C2",
			stem:     "<p>Prinsip utama yang mendasari Hukum Pertama Termodinamika adalah...</p>",
			options:  `[{"id":"A","text":"Kekekalan momentum"},{"id":"B","text":"Kekekalan massa"},{"id":"C","text":"Kekekalan energi"},{"id":"D","text":"Entropi selalu bertambah"},{"id":"E","text":"Suhu nol mutlak"}]`,
			answer:   `"C"`,
			exp:      "<p>Hukum Pertama Termodinamika adalah bentuk lain dari hukum kekekalan energi.</p>",
		},
		{
			cogLevel: "C3",
			stem:     "<p>Suatu gas menyerap kalor sebesar 800 J dan melakukan usaha sebesar 300 J. Berapakah perubahan energi dalam gas tersebut?</p>",
			options:  `[{"id":"A","text":"1.100 J"},{"id":"B","text":"500 J"},{"id":"C","text":"-500 J"},{"id":"D","text":"240 J"},{"id":"E","text":"300 J"}]`,
			answer:   `"B"`,
			exp:      "<p>Delta U = Q - W = 800 J - 300 J = 500 J.</p>",
		},
		{
			cogLevel: "C2",
			stem:     "<p>Proses termodinamika yang berlangsung pada volume tetap disebut proses...</p>",
			options:  `[{"id":"A","text":"Isotermik"},{"id":"B","text":"Isobarik"},{"id":"C","text":"Isokhorik"},{"id":"D","text":"Adiabatik"},{"id":"E","text":"Politropik"}]`,
			answer:   `"C"`,
			exp:      "<p>Proses pada volume konstan (Delta V = 0) disebut proses Isokhorik.</p>",
		},
		{
			cogLevel: "C4",
			stem:     "<p>Pada proses adiabatik, perpindahan kalor antara sistem dan lingkungan bernilai nol (Q = 0). Konsekuensi langsung terhadap energi dalam sistem jika gas melakukan usaha W > 0 adalah...</p>",
			options:  `[{"id":"A","text":"Energi dalam sistem bertambah"},{"id":"B","text":"Energi dalam sistem berkurang"},{"id":"C","text":"Suhu sistem selalu naik"},{"id":"D","text":"Tekanan sistem selalu konstan"},{"id":"E","text":"Tidak ada perubahan energi dalam"}]`,
			answer:   `"B"`,
			exp:      "<p>Karena Q = 0, maka Delta U = -W. Jika gas melakukan usaha positif (W > 0), maka Delta U bernilai negatif (energi dalam berkurang).</p>",
		},
		{
			cogLevel: "C3",
			stem:     "<p>Efisiensi maksimum mesin Carnot yang bekerja antara reservoir suhu tinggi 600 K dan reservoir suhu rendah 300 K adalah...</p>",
			options:  `[{"id":"A","text":"25%"},{"id":"B","text":"33%"},{"id":"C","text":"50%"},{"id":"D","text":"60%"},{"id":"E","text":"75%"}]`,
			answer:   `"C"`,
			exp:      "<p>Efisiensi = (1 - T_low/T_high) * 100% = (1 - 300/600) * 100% = 50%.</p>",
		},
	}

	for _, q := range sampleQuestions {
		_, _ = m.pool.Exec(ctx, `
			INSERT INTO cbt.questions (bank_id, question_type, cognitive_level, stem_html, options_json, correct_answer, explanation_html, is_ai_generated)
			VALUES ($1, 'mcq', $2, $3, $4::jsonb, $5::jsonb, $6, FALSE);
		`, bankID, q.cogLevel, q.stem, q.options, q.answer, q.exp)
	}

	// 7. Jadwal Ujian Aktif
	now := time.Now()
	endTime := now.Add(2 * time.Hour)

	_, err = m.pool.Exec(ctx, `
		INSERT INTO cbt.exam_schedules (id, bank_id, title, token_code, start_time, end_time, duration_minutes, status, shuffle_questions, shuffle_options, encryption_key_hex)
		VALUES (1, $1, 'UAS Fisika Peminatan XII - Termodinamika', 'FISIKA26', $2, $3, 90, 'draft', TRUE, TRUE, 'placeholder')
		ON CONFLICT (id) DO NOTHING;
	`, bankID, now, endTime)

	if err != nil {
		slog.Warn("Peringatan saat insert exam_schedules awal:", "err", err)
	}

	slog.Info("Seeding data awal berhasil!",
		"admin", "admin / admin123",
		"guru", "guru / guru123",
		"siswa", "siswa_1001 / siswa123",
		"token_ujian", "FISIKA26",
	)
	return nil
}

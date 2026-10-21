package cbt

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository interface {
	GetActiveSchedule(ctx context.Context) (*ExamSchedule, error)
	GetScheduleByID(ctx context.Context, id int) (*ExamSchedule, error)
	GetOrCreateSession(ctx context.Context, scheduleID int, studentID int64, clientIP string) (*ExamSession, error)
	UpdateSessionFinished(ctx context.Context, sessionID int64) error
	GetStudentAnswersFromDB(ctx context.Context, sessionID int64) (map[string]SingleAnswerPayload, error)
}

type pgRepository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) Repository {
	return &pgRepository{pool: pool}
}

func (r *pgRepository) GetActiveSchedule(ctx context.Context) (*ExamSchedule, error) {
	query := `
		SELECT id, bank_id, title, token_code, start_time, end_time, duration_minutes,
		       COALESCE(package_file_path, ''), COALESCE(encryption_key_hex, ''),
		       shuffle_questions, shuffle_options, status
		FROM cbt.exam_schedules
		WHERE status IN ('published', 'ongoing')
		ORDER BY start_time ASC
		LIMIT 1;
	`
	var s ExamSchedule
	err := r.pool.QueryRow(ctx, query).Scan(
		&s.ID,
		&s.BankID,
		&s.Title,
		&s.TokenCode,
		&s.StartTime,
		&s.EndTime,
		&s.DurationMinutes,
		&s.PackageFilePath,
		&s.EncryptionKeyHex,
		&s.ShuffleQuestions,
		&s.ShuffleOptions,
		&s.Status,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, errors.New("tidak ada jadwal ujian aktif saat ini")
		}
		return nil, fmt.Errorf("database query error: %w", err)
	}
	return &s, nil
}

func (r *pgRepository) GetScheduleByID(ctx context.Context, id int) (*ExamSchedule, error) {
	query := `
		SELECT id, bank_id, title, token_code, start_time, end_time, duration_minutes,
		       COALESCE(package_file_path, ''), COALESCE(encryption_key_hex, ''),
		       shuffle_questions, shuffle_options, status
		FROM cbt.exam_schedules
		WHERE id = $1;
	`
	var s ExamSchedule
	err := r.pool.QueryRow(ctx, query, id).Scan(
		&s.ID,
		&s.BankID,
		&s.Title,
		&s.TokenCode,
		&s.StartTime,
		&s.EndTime,
		&s.DurationMinutes,
		&s.PackageFilePath,
		&s.EncryptionKeyHex,
		&s.ShuffleQuestions,
		&s.ShuffleOptions,
		&s.Status,
	)
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func (r *pgRepository) GetOrCreateSession(ctx context.Context, scheduleID int, studentID int64, clientIP string) (*ExamSession, error) {
	now := time.Now()
	query := `
		INSERT INTO cbt.exam_sessions (schedule_id, student_id, started_at, client_ip, status)
		VALUES ($1, $2, $3, $4, 'working')
		ON CONFLICT (schedule_id, student_id)
		DO UPDATE SET client_ip = EXCLUDED.client_ip
		RETURNING id, schedule_id, student_id, started_at, finished_at, client_ip, violation_count, final_score, status;
	`
	var sess ExamSession
	err := r.pool.QueryRow(ctx, query, scheduleID, studentID, now, clientIP).Scan(
		&sess.ID,
		&sess.ScheduleID,
		&sess.StudentID,
		&sess.StartedAt,
		&sess.FinishedAt,
		&sess.ClientIP,
		&sess.ViolationCount,
		&sess.FinalScore,
		&sess.Status,
	)
	if err != nil {
		return nil, fmt.Errorf("gagal membuat/mengambil sesi ujian: %w", err)
	}
	return &sess, nil
}

func (r *pgRepository) UpdateSessionFinished(ctx context.Context, sessionID int64) error {
	now := time.Now()
	query := `
		UPDATE cbt.exam_sessions
		SET finished_at = $1, status = 'submitted'
		WHERE id = $2;
	`
	_, err := r.pool.Exec(ctx, query, now, sessionID)
	return err
}

func (r *pgRepository) GetStudentAnswersFromDB(ctx context.Context, sessionID int64) (map[string]SingleAnswerPayload, error) {
	query := `
		SELECT question_id, answer_payload
		FROM cbt.student_answers
		WHERE session_id = $1;
	`
	rows, err := r.pool.Query(ctx, query, sessionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	results := make(map[string]SingleAnswerPayload)
	for rows.Next() {
		var qID int64
		var payload SingleAnswerPayload
		if err := rows.Scan(&qID, &payload); err == nil {
			results[fmt.Sprintf("%d", qID)] = payload
		}
	}
	return results, nil
}

package lms

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type Repository interface {
	GetMaterialsByCourse(ctx context.Context, courseID int) ([]Material, error)
	CreateMaterial(ctx context.Context, m *Material) error
	GetAssignmentsByCourse(ctx context.Context, courseID int) ([]Assignment, error)
	SubmitAssignment(ctx context.Context, s *Submission) error
	GetUnifiedGradebook(ctx context.Context, courseID int) ([]GradebookEntry, error)
}

type pgRepository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) Repository {
	return &pgRepository{pool: pool}
}

func (r *pgRepository) GetMaterialsByCourse(ctx context.Context, courseID int) ([]Material, error) {
	query := `
		SELECT id, course_id, title, COALESCE(content_text, ''), COALESCE(attachment_object_key, ''),
		       COALESCE(video_embed_url, ''), is_published, created_at
		FROM lms.materials
		WHERE course_id = $1
		ORDER BY created_at DESC;
	`
	rows, err := r.pool.Query(ctx, query, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []Material
	for rows.Next() {
		var m Material
		if err := rows.Scan(&m.ID, &m.CourseID, &m.Title, &m.ContentText, &m.AttachmentObjectKey, &m.VideoEmbedURL, &m.IsPublished, &m.CreatedAt); err == nil {
			list = append(list, m)
		}
	}
	return list, nil
}

func (r *pgRepository) CreateMaterial(ctx context.Context, m *Material) error {
	query := `
		INSERT INTO lms.materials (course_id, title, content_text, attachment_object_key, video_embed_url, is_published)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, created_at;
	`
	return r.pool.QueryRow(ctx, query, m.CourseID, m.Title, m.ContentText, m.AttachmentObjectKey, m.VideoEmbedURL, m.IsPublished).Scan(&m.ID, &m.CreatedAt)
}

func (r *pgRepository) GetAssignmentsByCourse(ctx context.Context, courseID int) ([]Assignment, error) {
	query := `
		SELECT id, course_id, title, COALESCE(instructions, ''), due_date, max_score, created_at
		FROM lms.assignments
		WHERE course_id = $1
		ORDER BY due_date ASC;
	`
	rows, err := r.pool.Query(ctx, query, courseID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var list []Assignment
	for rows.Next() {
		var a Assignment
		if err := rows.Scan(&a.ID, &a.CourseID, &a.Title, &a.Instructions, &a.DueDate, &a.MaxScore, &a.CreatedAt); err == nil {
			list = append(list, a)
		}
	}
	return list, nil
}

func (r *pgRepository) SubmitAssignment(ctx context.Context, s *Submission) error {
	now := time.Now()
	query := `
		INSERT INTO lms.submissions (assignment_id, student_id, file_object_key, answer_text, submitted_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (assignment_id, student_id)
		DO UPDATE SET
			file_object_key = EXCLUDED.file_object_key,
			answer_text = EXCLUDED.answer_text,
			submitted_at = EXCLUDED.submitted_at
		RETURNING id;
	`
	return r.pool.QueryRow(ctx, query, s.AssignmentID, s.StudentID, s.FileObjectKey, s.AnswerText, now).Scan(&s.ID)
}

// GetUnifiedGradebook menggabungkan nilai tugas harian LMS dengan nilai ujian CBT
func (r *pgRepository) GetUnifiedGradebook(ctx context.Context, courseID int) ([]GradebookEntry, error) {
	query := `
		SELECT u.id, u.full_name,
		       AVG(sub.score) as avg_assignment,
		       AVG(sess.final_score) as avg_cbt
		FROM core.users u
		LEFT JOIN lms.submissions sub ON u.id = sub.student_id
		LEFT JOIN cbt.exam_sessions sess ON u.id = sess.student_id
		WHERE u.role = 'student'
		GROUP BY u.id, u.full_name
		ORDER BY u.full_name ASC;
	`
	rows, err := r.pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("gagal query unified gradebook: %w", err)
	}
	defer rows.Close()

	var entries []GradebookEntry
	for rows.Next() {
		var e GradebookEntry
		if err := rows.Scan(&e.StudentID, &e.StudentName, &e.AssignmentScore, &e.CBTExamScore); err == nil {
			// Perhitungan pembobotan nilai akhir (misal: 40% tugas LMS + 60% ujian CBT)
			asgVal := 0.0
			if e.AssignmentScore != nil {
				asgVal = *e.AssignmentScore
			}
			cbtVal := 0.0
			if e.CBTExamScore != nil {
				cbtVal = *e.CBTExamScore
			}
			e.FinalScore = (asgVal * 0.4) + (cbtVal * 0.6)
			entries = append(entries, e)
		}
	}
	return entries, nil
}

package lms

import "time"

type Course struct {
	ID             int       `json:"id"`
	AcademicYearID int16     `json:"academic_year_id"`
	TeacherID      int64     `json:"teacher_id"`
	SubjectName    string    `json:"subject_name"`
	GradeLevel     int16     `json:"grade_level"`
	CreatedAt      time.Time `json:"created_at"`
}

type Material struct {
	ID                  int64     `json:"id"`
	CourseID            int       `json:"course_id"`
	Title               string    `json:"title"`
	ContentText         string    `json:"content_text,omitempty"`
	AttachmentObjectKey string    `json:"attachment_object_key,omitempty"`
	AttachmentURL       string    `json:"attachment_url,omitempty"`
	VideoEmbedURL       string    `json:"video_embed_url,omitempty"`
	IsPublished         bool      `json:"is_published"`
	CreatedAt           time.Time `json:"created_at"`
}

type Assignment struct {
	ID           int64     `json:"id"`
	CourseID     int       `json:"course_id"`
	Title        string    `json:"title"`
	Instructions string    `json:"instructions"`
	DueDate      time.Time `json:"due_date"`
	MaxScore     float64   `json:"max_score"`
	CreatedAt    time.Time `json:"created_at"`
}

type Submission struct {
	ID             int64      `json:"id"`
	AssignmentID   int64      `json:"assignment_id"`
	StudentID      int64      `json:"student_id"`
	StudentName    string     `json:"student_name,omitempty"`
	FileObjectKey  string     `json:"file_object_key,omitempty"`
	FileURL        string     `json:"file_url,omitempty"`
	AnswerText     string     `json:"answer_text,omitempty"`
	Score          *float64   `json:"score"`
	AIFeedback     string     `json:"ai_feedback,omitempty"`
	SubmittedAt    time.Time  `json:"submitted_at"`
}

type PresignUploadRequest struct {
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
	SizeBytes   int64  `json:"size_bytes"`
}

type PresignUploadResponse struct {
	UploadURL string `json:"upload_url"`
	ObjectKey string `json:"object_key"`
	ExpiresIn int    `json:"expires_in"`
}

type GradebookEntry struct {
	StudentID       int64    `json:"student_id"`
	StudentName     string   `json:"student_name"`
	AssignmentScore *float64 `json:"assignment_score"`
	CBTExamScore    *float64 `json:"cbt_exam_score"`
	FinalScore      float64  `json:"final_score"`
}

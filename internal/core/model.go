package core

import "time"

type Role string

const (
	RoleAdmin   Role = "admin"
	RoleTeacher Role = "teacher"
	RoleStudent Role = "student"
	RoleProctor Role = "proctor"
)

type User struct {
	ID           int64     `json:"id"`
	Username     string    `json:"username"`
	PasswordHash string    `json:"-"`
	FullName     string    `json:"full_name"`
	Role         Role      `json:"role"`
	ClassID      *int      `json:"class_id,omitempty"`
	ClassName    string    `json:"class_name,omitempty"`
	IsActive     bool      `json:"is_active"`
	CreatedAt    time.Time `json:"created_at"`
}

type Class struct {
	ID             int    `json:"id"`
	AcademicYearID int16  `json:"academic_year_id"`
	Name           string `json:"name"`
	GradeLevel     int16  `json:"grade_level"`
}

type AcademicYear struct {
	ID       int16  `json:"id"`
	Name     string `json:"name"`
	IsActive bool   `json:"is_active"`
}

type LoginRequest struct {
	Username          string `json:"username"`
	Password          string `json:"password"`
	DeviceFingerprint string `json:"device_fingerprint,omitempty"`
}

type LoginResponseData struct {
	AccessToken      string `json:"access_token"`
	ExpiresIn        int    `json:"expires_in"`
	ExamLockdownMode bool   `json:"exam_lockdown_mode"`
	User             User   `json:"user"`
}

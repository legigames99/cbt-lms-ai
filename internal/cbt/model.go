package cbt

import (
	"encoding/json"
	"time"
)

type QuestionType string

const (
	TypeMCQ      QuestionType = "mcq"
	TypeMultiMCQ QuestionType = "multi_mcq"
	TypeEssay    QuestionType = "essay"
)

type OptionItem struct {
	ID   string `json:"id"`   // "A", "B", "C", "D", "E"
	Text string `json:"text"` // Isi teks atau HTML pilihan
}

// Question mewakili satu butir soal di database
type Question struct {
	ID              int64           `json:"id"`
	BankID          int             `json:"bank_id"`
	QuestionType    QuestionType    `json:"question_type"`
	CognitiveLevel  string          `json:"cognitive_level"` // C1 - C6
	StemHTML        string          `json:"stem_html"`
	OptionsJSON     json.RawMessage `json:"options"`          // []OptionItem
	CorrectAnswer   json.RawMessage `json:"correct_answer,omitempty"` // "A" / ["A","C"]
	ExplanationHTML string          `json:"explanation_html,omitempty"`
	ScoreWeight     float64         `json:"score_weight"`
	IsAIGenerated   bool            `json:"is_ai_generated"`
	CreatedAt       time.Time       `json:"created_at"`
}

// ClientQuestion adalah struktur soal terenkripsi untuk siswa (TANPA kunci dan pembahasan)
type ClientQuestion struct {
	ID             int64           `json:"id"`
	QuestionType   QuestionType    `json:"type"`
	CognitiveLevel string          `json:"cog,omitempty"`
	StemHTML       string          `json:"stem"`
	Options        json.RawMessage `json:"options"`
	ScoreWeight    float64         `json:"weight"`
}

type ExamSchedule struct {
	ID               int       `json:"id"`
	BankID           int       `json:"bank_id"`
	Title            string    `json:"title"`
	TokenCode        string    `json:"token_code"`
	StartTime        time.Time `json:"start_time"`
	EndTime          time.Time `json:"end_time"`
	DurationMinutes  int16     `json:"duration_minutes"`
	PackageFilePath  string    `json:"package_file_path"`
	PackageSHA256    string    `json:"package_sha256,omitempty"`
	EncryptionKeyHex string    `json:"encryption_key_hex,omitempty"`
	ShuffleQuestions bool      `json:"shuffle_questions"`
	ShuffleOptions   bool      `json:"shuffle_options"`
	Status           string    `json:"status"` // draft, published, ongoing, finished
}

type ExamSession struct {
	ID             int64      `json:"id"`
	ScheduleID     int        `json:"schedule_id"`
	StudentID      int64      `json:"student_id"`
	StartedAt      *time.Time `json:"started_at"`
	FinishedAt     *time.Time `json:"finished_at"`
	ClientIP       string     `json:"client_ip"`
	ViolationCount int16      `json:"violation_count"`
	FinalScore     *float64   `json:"final_score"`
	Status         string     `json:"status"` // waiting, working, submitted
}

type SingleAnswerPayload struct {
	Ans       string `json:"a"`           // Jawaban terpilih ("A", "B", dll.)
	IsDoubt   int    `json:"d"`           // 1 = ragu-ragu, 0 = yakin
	Timestamp int64  `json:"ts,omitempty"` // Unix timestamp saat dijawab di browser
}

type SyncAnswerRequest struct {
	SessionID      int64                          `json:"session_id"`
	Answers        map[string]SingleAnswerPayload `json:"answers"` // key: question_id (string)
	ViolationDelta int16                          `json:"violation_delta"`
}

type StartExamRequest struct {
	TokenCode string `json:"token_code"`
}

type StartExamResponse struct {
	SessionID        int64                          `json:"session_id"`
	DecryptionKeyHex string                         `json:"decryption_key_hex"`
	ServerTime       int64                          `json:"server_time"`
	SavedAnswers     map[string]SingleAnswerPayload `json:"saved_answers"`
}

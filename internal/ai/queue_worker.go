package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type AIQueueWorker struct {
	pool          *pgxpool.Pool
	aiClient      AIClient
	promptBuilder *PromptBuilder
	subscribers   map[string][]chan AIJobProgressEvent
	subMutex      sync.RWMutex
}

func NewAIQueueWorker(pool *pgxpool.Pool, client AIClient) *AIQueueWorker {
	return &AIQueueWorker{
		pool:          pool,
		aiClient:      client,
		promptBuilder: NewPromptBuilder(),
		subscribers:   make(map[string][]chan AIJobProgressEvent),
	}
}

// SubscribeEvents mendaftarkan channel SSE untuk memantau job
func (w *AIQueueWorker) SubscribeEvents(jobID string) chan AIJobProgressEvent {
	w.subMutex.Lock()
	defer w.subMutex.Unlock()

	ch := make(chan AIJobProgressEvent, 10)
	w.subscribers[jobID] = append(w.subscribers[jobID], ch)
	return ch
}

// UnsubscribeEvents membersihkan channel SSE
func (w *AIQueueWorker) UnsubscribeEvents(jobID string, ch chan AIJobProgressEvent) {
	w.subMutex.Lock()
	defer w.subMutex.Unlock()

	channels := w.subscribers[jobID]
	for i, c := range channels {
		if c == ch {
			close(c)
			w.subscribers[jobID] = append(channels[:i], channels[i+1:]...)
			break
		}
	}
	if len(w.subscribers[jobID]) == 0 {
		delete(w.subscribers, jobID)
	}
}

func (w *AIQueueWorker) publishEvent(jobID string, event AIJobProgressEvent) {
	w.subMutex.RLock()
	defer w.subMutex.RUnlock()

	for _, ch := range w.subscribers[jobID] {
		select {
		case ch <- event:
		default:
		}
	}
}

// EnqueueJob memproses pembuatan soal secara asynchronous di latar belakang
func (w *AIQueueWorker) EnqueueJob(jobID string, req GenerateQuestionsJobRequest) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		defer cancel()

		w.publishEvent(jobID, AIJobProgressEvent{
			JobID:     jobID,
			Status:    JobStatusProcessing,
			Completed: 0,
			Total:     req.QuestionCount,
			Message:   "Mengambil bahan ajar materi dari database...",
		})

		// 1. Ambil materi LMS
		var materialTitle, materialContent string
		matQuery := `SELECT title, COALESCE(content_text, '') FROM lms.materials WHERE id = $1;`
		if err := w.pool.QueryRow(ctx, matQuery, req.MaterialID).Scan(&materialTitle, &materialContent); err != nil {
			materialTitle = "Materi Pelajaran"
			materialContent = "Materi umum sesuai kurikulum."
		}

		w.publishEvent(jobID, AIJobProgressEvent{
			JobID:     jobID,
			Status:    JobStatusProcessing,
			Completed: 2,
			Total:     req.QuestionCount,
			Message:   "Memanggil AI Engine untuk menyusun butir soal dan opsi jawaban...",
		})

		// 2. Susun prompt & panggil AI
		prompt := w.promptBuilder.BuildQuestionPrompt(materialTitle, materialContent, req)
		payload, err := w.aiClient.GenerateQuestions(ctx, prompt)
		if err != nil {
			slog.Error("Pembuatan soal AI gagal", "job_id", jobID, "err", err)
			w.publishEvent(jobID, AIJobProgressEvent{
				JobID:   jobID,
				Status:  JobStatusFailed,
				Message: fmt.Sprintf("Gagal menghasilkan soal: %v", err),
			})
			return
		}

		w.publishEvent(jobID, AIJobProgressEvent{
			JobID:     jobID,
			Status:    JobStatusProcessing,
			Completed: len(payload.Questions),
			Total:     req.QuestionCount,
			Message:   "Menyimpan butir soal ke Bank Soal...",
		})

		// 3. Simpan butir soal ke tabel cbt.questions
		insertedCount := 0
		for _, q := range payload.Questions {
			optionsBytes, _ := json.Marshal(q.Options)
			correctAnswerBytes, _ := json.Marshal(q.CorrectAnswer)

			insertQuery := `
				INSERT INTO cbt.questions (bank_id, question_type, cognitive_level, stem_html, options_json, correct_answer, explanation_html, is_ai_generated)
				VALUES ($1, 'mcq', $2, $3, $4, $5, $6, TRUE);
			`
			_, err := w.pool.Exec(ctx, insertQuery, req.BankID, q.CognitiveLevel, q.StemHTML, optionsBytes, correctAnswerBytes, q.ExplanationHTML)
			if err == nil {
				insertedCount++
			}
		}

		// Update total questions di bank soal
		_, _ = w.pool.Exec(ctx, `UPDATE cbt.question_banks SET total_questions = total_questions + $1 WHERE id = $2;`, insertedCount, req.BankID)

		w.publishEvent(jobID, AIJobProgressEvent{
			JobID:         jobID,
			Status:        JobStatusCompleted,
			Completed:     insertedCount,
			Total:         req.QuestionCount,
			InsertedCount: insertedCount,
			Message:       fmt.Sprintf("Berhasil membuat %d butir soal ke dalam Bank Soal!", insertedCount),
		})
	}()
}

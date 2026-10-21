package cbt

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strconv"
	"strings"
	"sync"
	"time"

	"cbt-lms-ai/internal/platform/cache"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type BatchWorker struct {
	pool       *pgxpool.Pool
	rdb        *redis.Client
	interval   time.Duration
	stopChan   chan struct{}
	wg         sync.WaitGroup
	activeLock sync.Mutex
}

func NewBatchWorker(pool *pgxpool.Pool, rdb *redis.Client, interval time.Duration) *BatchWorker {
	if interval <= 0 {
		interval = 20 * time.Second
	}
	return &BatchWorker{
		pool:     pool,
		rdb:      rdb,
		interval: interval,
		stopChan: make(chan struct{}),
	}
}

// Start menjalankan background goroutine untuk sinkronisasi massal Redis -> PostgreSQL
func (w *BatchWorker) Start() {
	w.wg.Add(1)
	go func() {
		defer w.wg.Done()
		ticker := time.NewTicker(w.interval)
		defer ticker.Stop()

		slog.Info("CBT Batch Worker dimulai", "interval_sec", w.interval.Seconds())

		for {
			select {
			case <-ticker.C:
				w.flushAllDirtySessions()
			case <-w.stopChan:
				slog.Info("Menghentikan CBT Batch Worker, melakukan flush terakhir...")
				w.flushAllDirtySessions()
				return
			}
		}
	}()
}

// Stop menghentikan worker secara graceful
func (w *BatchWorker) Stop() {
	close(w.stopChan)
	w.wg.Wait()
}

// FlushAllDirtySessions melakukan pemindahan seluruh sesi jawaban kotor dari Redis ke DB
func (w *BatchWorker) FlushAllDirtySessions() {
	w.flushAllDirtySessions()
}

func (w *BatchWorker) flushAllDirtySessions() {
	w.activeLock.Lock()
	defer w.activeLock.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	if w.rdb == nil || w.pool == nil {
		return
	}

	// 1. Cari seluruh key dirty_sessions di Redis
	var cursor uint64
	var dirtyKeys []string
	for {
		keys, nextCursor, err := w.rdb.Scan(ctx, cursor, "cbt:dirty_sessions:*", 100).Result()
		if err != nil {
			slog.Error("BatchWorker scan redis error", "err", err)
			return
		}
		dirtyKeys = append(dirtyKeys, keys...)
		cursor = nextCursor
		if cursor == 0 {
			break
		}
	}

	if len(dirtyKeys) == 0 {
		return
	}

	startTime := time.Now()
	totalFlushed := 0

	for _, dirtyKey := range dirtyKeys {
		// dirtyKey format: "cbt:dirty_sessions:{schedule_id}"
		parts := strings.Split(dirtyKey, ":")
		if len(parts) < 3 {
			continue
		}
		scheduleID, err := strconv.Atoi(parts[2])
		if err != nil {
			continue
		}

		// Ambil seluruh student_id yang ada di SET dan hapus dari SET menggunakan SPOP berulang atau SMEMBERS
		studentIDs, err := w.rdb.SMembers(ctx, dirtyKey).Result()
		if err != nil || len(studentIDs) == 0 {
			continue
		}

		// Hapus dari set setelah diambil
		_ = w.rdb.Del(ctx, dirtyKey).Err()

		for _, sIDStr := range studentIDs {
			studentID, err := strconv.ParseInt(sIDStr, 10, 64)
			if err != nil {
				continue
			}

			ansKey := cache.StudentAnswerKey(scheduleID, studentID)
			answersMap, err := w.rdb.HGetAll(ctx, ansKey).Result()
			if err != nil || len(answersMap) == 0 {
				continue
			}

			// Ambil session_id untuk student ini
			var sessionID int64
			sessQuery := `SELECT id FROM cbt.exam_sessions WHERE schedule_id = $1 AND student_id = $2;`
			if err := w.pool.QueryRow(ctx, sessQuery, scheduleID, studentID).Scan(&sessionID); err != nil {
				continue
			}

			// Susun array untuk PostgreSQL Bulk Upsert (UNNEST)
			var sessionIDs []int64
			var questionIDs []int64
			var answerPayloads [][]byte
			var updatedAts []time.Time
			now := time.Now()

			for qKey, payloadStr := range answersMap {
				// qKey format: "q_105"
				qIDStr := strings.TrimPrefix(qKey, "q_")
				qID, err := strconv.ParseInt(qIDStr, 10, 64)
				if err != nil {
					continue
				}

				sessionIDs = append(sessionIDs, sessionID)
				questionIDs = append(questionIDs, qID)
				answerPayloads = append(answerPayloads, []byte(payloadStr))
				updatedAts = append(updatedAts, now)
			}

			if len(sessionIDs) > 0 {
				bulkUpsertQuery := `
					INSERT INTO cbt.student_answers (session_id, question_id, answer_payload, updated_at)
					SELECT * FROM UNNEST($1::bigint[], $2::bigint[], $3::jsonb[], $4::timestamptz[])
					ON CONFLICT (session_id, question_id)
					DO UPDATE SET
						answer_payload = EXCLUDED.answer_payload,
						updated_at = EXCLUDED.updated_at;
				`
				_, err := w.pool.Exec(ctx, bulkUpsertQuery, sessionIDs, questionIDs, answerPayloads, updatedAts)
				if err != nil {
					slog.Error("Bulk upsert jawaban siswa gagal", "student_id", studentID, "schedule_id", scheduleID, "err", err)
				} else {
					totalFlushed++
				}
			}
		}
	}

	duration := time.Since(startTime)
	if totalFlushed > 0 {
		slog.Info("CBT Batch Worker selesai sinkronisasi",
			"flushed_sessions", totalFlushed,
			"duration_ms", duration.Milliseconds(),
		)
	}
}

// Helper serialize single answer payload
func SerializeAnswerPayload(payload SingleAnswerPayload) string {
	b, _ := json.Marshal(payload)
	return string(b)
}

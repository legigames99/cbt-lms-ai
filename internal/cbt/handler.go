package cbt

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	"cbt-lms-ai/internal/core"
	"cbt-lms-ai/internal/platform/cache"
	"github.com/gofiber/fiber/v2"
	"github.com/redis/go-redis/v9"
)

type CBTHandler struct {
	repo        Repository
	packager    *Packager
	batchWorker *BatchWorker
	rdb         *redis.Client
}

func NewCBTHandler(repo Repository, packager *Packager, worker *BatchWorker, rdb *redis.Client) *CBTHandler {
	return &CBTHandler{
		repo:        repo,
		packager:    packager,
		batchWorker: worker,
		rdb:         rdb,
	}
}

// GetActiveSchedule mengembalikan jadwal ujian yang aktif dan tautan paket soal statis
func (h *CBTHandler) GetActiveSchedule(c *fiber.Ctx) error {
	ctx, cancel := context.WithTimeout(c.Context(), 2*time.Second)
	defer cancel()

	schedule, err := h.repo.GetActiveSchedule(ctx)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"status":  "error",
			"message": err.Error(),
		})
	}

	return c.JSON(fiber.Map{
		"status": "success",
		"data": fiber.Map{
			"schedule_id":      schedule.ID,
			"title":            schedule.Title,
			"start_time":       schedule.StartTime.Format(time.RFC3339),
			"end_time":         schedule.EndTime.Format(time.RFC3339),
			"duration_minutes": schedule.DurationMinutes,
			"package_url":      schedule.PackageFilePath,
			"package_sha256":   schedule.PackageSHA256,
		},
	})
}

// StartExam memvalidasi token ujian, membuat sesi, dan mengembalikan kunci dekripsi mikro (< 1 KB)
func (h *CBTHandler) StartExam(c *fiber.Ctx) error {
	scheduleID, err := strconv.Atoi(c.Params("schedule_id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"status":  "error",
			"message": "ID jadwal ujian tidak valid",
		})
	}

	var req StartExamRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"status":  "error",
			"message": "Format request tidak valid",
		})
	}

	claims := c.Locals("user").(*core.JWTClaims)
	ctx, cancel := context.WithTimeout(c.Context(), 3*time.Second)
	defer cancel()

	schedule, err := h.repo.GetScheduleByID(ctx, scheduleID)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"status":  "error",
			"message": "Jadwal ujian tidak ditemukan",
		})
	}

	// Validasi token ujian
	if schedule.TokenCode != req.TokenCode {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"status":  "error",
			"message": "Token ujian salah atau tidak sesuai",
		})
	}

	// Buat atau dapatkan sesi ujian siswa
	session, err := h.repo.GetOrCreateSession(ctx, scheduleID, claims.UserID, c.IP())
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"status":  "error",
			"message": "Gagal menyiapkan sesi ujian",
		})
	}

	if session.Status == "submitted" {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"status":  "error",
			"message": "Anda sudah menyelesaikan ujian ini",
		})
	}

	// Ambil Kunci Dekripsi dari Redis Cache (sub-millisecond) atau fallback ke DB
	decryptionKey := schedule.EncryptionKeyHex
	if h.rdb != nil {
		cachedKey, err := h.rdb.Get(ctx, cache.ExamKeyPattern(scheduleID)).Result()
		if err == nil && cachedKey != "" {
			decryptionKey = cachedKey
		}
	}

	// Ambil jawaban yang sebelumnya tersimpan (jika siswa reload browser / ganti perangkat)
	savedAnswers := make(map[string]SingleAnswerPayload)
	if h.rdb != nil {
		rawAnswers, _ := h.rdb.HGetAll(ctx, cache.StudentAnswerKey(scheduleID, claims.UserID)).Result()
		for qKey, val := range rawAnswers {
			var p SingleAnswerPayload
			if err := json.Unmarshal([]byte(val), &p); err == nil {
				savedAnswers[qKey] = p
			}
		}
	}
	if len(savedAnswers) == 0 {
		dbAnswers, _ := h.repo.GetStudentAnswersFromDB(ctx, session.ID)
		if len(dbAnswers) > 0 {
			savedAnswers = dbAnswers
		}
	}

	return c.JSON(fiber.Map{
		"status": "success",
		"data": StartExamResponse{
			SessionID:        session.ID,
			DecryptionKeyHex: decryptionKey,
			ServerTime:       time.Now().Unix(),
			SavedAnswers:     savedAnswers,
		},
	})
}

// SyncAnswers menerima sinkronisasi jawaban periodik (Jitter) dan menyimpannya instan ke Redis
func (h *CBTHandler) SyncAnswers(c *fiber.Ctx) error {
	scheduleID, err := strconv.Atoi(c.Params("schedule_id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"status": "error", "message": "ID jadwal tidak valid"})
	}

	var req SyncAnswerRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"status": "error", "message": "Payload sinkronisasi tidak valid"})
	}

	claims := c.Locals("user").(*core.JWTClaims)
	ctx := c.Context()
	syncedCount := 0

	if h.rdb != nil && len(req.Answers) > 0 {
		ansKey := cache.StudentAnswerKey(scheduleID, claims.UserID)
		pipe := h.rdb.Pipeline()

		for qID, ans := range req.Answers {
			qField := fmt.Sprintf("q_%s", qID)
			payloadBytes, _ := json.Marshal(ans)
			pipe.HSet(ctx, ansKey, qField, string(payloadBytes))
			syncedCount++
		}

		// Tandai sesi kotor agar disinkronkan ke PostgreSQL oleh Batch Worker
		pipe.SAdd(ctx, cache.DirtySessionsKey(scheduleID), claims.UserID)

		// Perbarui presence siswa di Redis ZSET
		pipe.ZAdd(ctx, cache.PresenceKey(scheduleID), redis.Z{
			Score:  float64(time.Now().Unix()),
			Member: claims.UserID,
		})

		_, _ = pipe.Exec(ctx)
	}

	return c.JSON(fiber.Map{
		"ack":          true,
		"synced_count": syncedCount,
		"server_ts":    time.Now().Unix(),
	})
}

// FinishExam memproses penyelesaian ujian secara final
func (h *CBTHandler) FinishExam(c *fiber.Ctx) error {
	scheduleID, err := strconv.Atoi(c.Params("schedule_id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"status": "error", "message": "ID jadwal tidak valid"})
	}

	var req SyncAnswerRequest
	_ = c.BodyParser(&req)

	claims := c.Locals("user").(*core.JWTClaims)
	ctx := c.Context()

	// Simpan sisa jawaban terakhir jika ada
	if h.rdb != nil && len(req.Answers) > 0 {
		ansKey := cache.StudentAnswerKey(scheduleID, claims.UserID)
		pipe := h.rdb.Pipeline()
		for qID, ans := range req.Answers {
			qField := fmt.Sprintf("q_%s", qID)
			payloadBytes, _ := json.Marshal(ans)
			pipe.HSet(ctx, ansKey, qField, string(payloadBytes))
		}
		pipe.SAdd(ctx, cache.DirtySessionsKey(scheduleID), claims.UserID)
		_, _ = pipe.Exec(ctx)
	}

	// Update status sesi menjadi 'submitted'
	if req.SessionID > 0 {
		_ = h.repo.UpdateSessionFinished(ctx, req.SessionID)
	}

	return c.JSON(fiber.Map{
		"status":    "success",
		"message":   "Ujian berhasil diselesaikan dan jawaban telah diamankan",
		"server_ts": time.Now().Unix(),
	})
}

// PublishExamPackage (Admin/Guru): Mengompilasi dan mengenkripsi soal menjadi file statis
func (h *CBTHandler) PublishExamPackage(c *fiber.Ctx) error {
	scheduleID, err := strconv.Atoi(c.Params("schedule_id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"status": "error", "message": "ID jadwal tidak valid"})
	}

	ctx, cancel := context.WithTimeout(c.Context(), 10*time.Second)
	defer cancel()

	schedule, err := h.packager.BuildAndEncryptExamPackage(ctx, scheduleID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"status":  "error",
			"message": fmt.Sprintf("Gagal mempublikasikan paket soal: %v", err),
		})
	}

	return c.JSON(fiber.Map{
		"status":  "success",
		"message": "Paket soal berhasil dienkripsi dan dipublikasikan",
		"data": fiber.Map{
			"schedule_id":      schedule.ID,
			"package_url":      schedule.PackageFilePath,
			"package_sha256":   schedule.PackageSHA256,
			"encryption_key":   schedule.EncryptionKeyHex,
		},
	})
}

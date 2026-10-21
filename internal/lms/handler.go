package lms

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"cbt-lms-ai/internal/core"
	"cbt-lms-ai/internal/platform/cache"
	"cbt-lms-ai/internal/platform/storage"
	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

type LMSHandler struct {
	repo    Repository
	storage storage.StorageProvider
	rdb     *redis.Client
}

func NewLMSHandler(repo Repository, storage storage.StorageProvider, rdb *redis.Client) *LMSHandler {
	return &LMSHandler{
		repo:    repo,
		storage: storage,
		rdb:     rdb,
	}
}

// GeneratePresignedUpload menghasilkan URL upload langsung ke Cloudflare R2 / S3
func (h *LMSHandler) GeneratePresignedUpload(c *fiber.Ctx) error {
	var req PresignUploadRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"status":  "error",
			"message": "Format request tidak valid",
		})
	}

	claims := c.Locals("user").(*core.JWTClaims)
	timestamp := time.Now().Format("2006/01")
	ext := "bin"
	if req.Filename != "" {
		ext = req.Filename
	}

	objectKey := fmt.Sprintf("submissions/%s/%d_%s_%s", timestamp, claims.UserID, uuid.New().String()[:8], ext)
	expiresIn := 10 * time.Minute

	presignedURL, err := h.storage.GeneratePresignedUploadURL(objectKey, req.ContentType, expiresIn)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"status":  "error",
			"message": "Gagal menghasilkan URL upload",
		})
	}

	return c.JSON(fiber.Map{
		"status": "success",
		"data": PresignUploadResponse{
			UploadURL: presignedURL,
			ObjectKey: objectKey,
			ExpiresIn: int(expiresIn.Seconds()),
		},
	})
}

// GetMaterials mengambil daftar materi pada suatu kursus
func (h *LMSHandler) GetMaterials(c *fiber.Ctx) error {
	courseID, err := strconv.Atoi(c.Params("course_id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"status": "error", "message": "ID kursus tidak valid"})
	}

	ctx, cancel := context.WithTimeout(c.Context(), 3*time.Second)
	defer cancel()

	materials, err := h.repo.GetMaterialsByCourse(ctx, courseID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"status": "error", "message": "Gagal mengambil materi"})
	}

	// Buat public URL jika ada file attachment
	for i := range materials {
		if materials[i].AttachmentObjectKey != "" {
			materials[i].AttachmentURL = h.storage.GetPublicURL(materials[i].AttachmentObjectKey)
		}
	}

	return c.JSON(fiber.Map{"status": "success", "data": materials})
}

// CreateMaterial membuat materi baru
func (h *LMSHandler) CreateMaterial(c *fiber.Ctx) error {
	courseID, err := strconv.Atoi(c.Params("course_id"))
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"status": "error", "message": "ID kursus tidak valid"})
	}

	var m Material
	if err := c.BodyParser(&m); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"status": "error", "message": "Payload tidak valid"})
	}
	m.CourseID = courseID

	ctx, cancel := context.WithTimeout(c.Context(), 3*time.Second)
	defer cancel()

	if err := h.repo.CreateMaterial(ctx, &m); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"status": "error", "message": "Gagal menyimpan materi"})
	}

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{"status": "success", "data": m})
}

// SubmitAssignment mengumpulkan tugas siswa dengan menyertakan object_key dari upload R2
func (h *LMSHandler) SubmitAssignment(c *fiber.Ctx) error {
	assignmentID, err := strconv.ParseInt(c.Params("assignment_id"), 10, 64)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"status": "error", "message": "ID tugas tidak valid"})
	}

	var s Submission
	if err := c.BodyParser(&s); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"status": "error", "message": "Payload tidak valid"})
	}

	claims := c.Locals("user").(*core.JWTClaims)
	s.AssignmentID = assignmentID
	s.StudentID = claims.UserID

	ctx, cancel := context.WithTimeout(c.Context(), 3*time.Second)
	defer cancel()

	if err := h.repo.SubmitAssignment(ctx, &s); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"status": "error", "message": "Gagal mengumpulkan tugas"})
	}

	return c.JSON(fiber.Map{"status": "success", "message": "Tugas berhasil dikumpulkan", "data": s})
}

// GetGradebook mengambil rekapan nilai terpadu (LMS + CBT)
func (h *LMSHandler) GetGradebook(c *fiber.Ctx) error {
	courseID, _ := strconv.Atoi(c.Params("course_id"))

	ctx, cancel := context.WithTimeout(c.Context(), 5*time.Second)
	defer cancel()

	grades, err := h.repo.GetUnifiedGradebook(ctx, courseID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"status": "error", "message": "Gagal mengambil buku nilai"})
	}

	return c.JSON(fiber.Map{"status": "success", "data": grades})
}

// ToggleLockdownMode (Admin): Mengaktifkan/menonaktifkan sakelar Exam Lockdown Mode
func (h *LMSHandler) ToggleLockdownMode(c *fiber.Ctx) error {
	var body struct {
		Enabled bool `json:"enabled"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"status": "error", "message": "Format request tidak valid"})
	}

	ctx := c.Context()
	val := "0"
	if body.Enabled {
		val = "1"
	}

	if h.rdb != nil {
		if err := h.rdb.Set(ctx, cache.KeyLockdownMode, val, 0).Err(); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"status": "error", "message": "Gagal memperbarui status lockdown di Redis"})
		}
	}

	return c.JSON(fiber.Map{
		"status":        "success",
		"message":       "Status Exam Lockdown Mode berhasil diperbarui",
		"lockdown_mode": body.Enabled,
	})
}

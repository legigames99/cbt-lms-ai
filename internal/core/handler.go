package core

import (
	"context"
	"time"

	"cbt-lms-ai/internal/platform/cache"
	"github.com/gofiber/fiber/v2"
	"github.com/redis/go-redis/v9"
)

type AuthHandler struct {
	repo         Repository
	tokenService *TokenService
	redisClient  *redis.Client
}

func NewAuthHandler(repo Repository, tokenService *TokenService, rdb *redis.Client) *AuthHandler {
	return &AuthHandler{
		repo:         repo,
		tokenService: tokenService,
		redisClient:  rdb,
	}
}

// HandleLogin memproses login tunggal (SSO) untuk Siswa, Guru, Proktor, Admin
func (h *AuthHandler) HandleLogin(c *fiber.Ctx) error {
	var req LoginRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"status":  "error",
			"message": "Format payload login tidak valid",
		})
	}

	if req.Username == "" || req.Password == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"status":  "error",
			"message": "Username dan password wajib diisi",
		})
	}

	ctx, cancel := context.WithTimeout(c.Context(), 3*time.Second)
	defer cancel()

	user, err := h.repo.GetUserByUsername(ctx, req.Username)
	if err != nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"status":  "error",
			"message": "Username atau password salah",
		})
	}

	if !user.IsActive {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"status":  "error",
			"message": "Akun Anda dinonaktifkan. Silakan hubungi admin sekolah.",
		})
	}

	if !CheckPassword(req.Password, user.PasswordHash) {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"status":  "error",
			"message": "Username atau password salah",
		})
	}

	// Buat Stateless JWT
	token, expiresIn, err := h.tokenService.GenerateAccessToken(user)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"status":  "error",
			"message": "Gagal membuat sesi login",
		})
	}

	// Cek status Exam Lockdown Mode di Redis
	isLockdown := false
	if h.redisClient != nil {
		val, _ := h.redisClient.Get(ctx, cache.KeyLockdownMode).Result()
		isLockdown = (val == "1")
	}

	// Set HttpOnly Cookie untuk keamanan ekstra
	c.Cookie(&fiber.Cookie{
		Name:     "cbt_token",
		Value:    token,
		Expires:  time.Now().Add(time.Duration(expiresIn) * time.Second),
		HTTPOnly: true,
		SameSite: "Lax",
	})

	return c.Status(fiber.StatusOK).JSON(fiber.Map{
		"status": "success",
		"data": LoginResponseData{
			AccessToken:      token,
			ExpiresIn:        expiresIn,
			ExamLockdownMode: isLockdown,
			User:             *user,
		},
	})
}

// HandleGetMe mengembalikan profil user yang sedang login dari Claims JWT
func (h *AuthHandler) HandleGetMe(c *fiber.Ctx) error {
	claims, ok := c.Locals("user").(*JWTClaims)
	if !ok || claims == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"status":  "error",
			"message": "Sesi tidak terautentikasi",
		})
	}

	return c.JSON(fiber.Map{
		"status": "success",
		"data":   claims,
	})
}

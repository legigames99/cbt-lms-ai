package middleware

import (
	"strings"

	"cbt-lms-ai/internal/core"
	"github.com/gofiber/fiber/v2"
)

// AuthGuard memvalidasi token JWT secara stateless tanpa query ke database
func AuthGuard(tokenService *core.TokenService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var tokenStr string

		// 1. Cek Header Authorization: Bearer <token>
		authHeader := c.Get("Authorization")
		if strings.HasPrefix(authHeader, "Bearer ") {
			tokenStr = strings.TrimPrefix(authHeader, "Bearer ")
		}

		// 2. Fallback ke HttpOnly Cookie
		if tokenStr == "" {
			tokenStr = c.Cookies("cbt_token")
		}

		if tokenStr == "" {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"status":  "error",
				"message": "Akses ditolak: Token autentikasi tidak ditemukan",
			})
		}

		claims, err := tokenService.ValidateToken(tokenStr)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"status":  "error",
				"message": "Akses ditolak: Token tidak valid atau kadaluarsa",
			})
		}

		// Simpan claims ke konteks request lokal Fiber
		c.Locals("user", claims)
		return c.Next()
	}
}

// RequireRole membatasi endpoint hanya untuk peran tertentu
func RequireRole(allowedRoles ...core.Role) fiber.Handler {
	return func(c *fiber.Ctx) error {
		claims, ok := c.Locals("user").(*core.JWTClaims)
		if !ok || claims == nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"status":  "error",
				"message": "Pengguna tidak terautentikasi",
			})
		}

		for _, role := range allowedRoles {
			if claims.Role == role {
				return c.Next()
			}
		}

		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
			"status":  "error",
			"message": "Anda tidak memiliki hak akses ke resource ini",
		})
	}
}

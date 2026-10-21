package middleware

import (
	"context"
	"time"

	"cbt-lms-ai/internal/core"
	"cbt-lms-ai/internal/platform/cache"
	"github.com/gofiber/fiber/v2"
	"github.com/redis/go-redis/v9"
)

// ExamLockdownGuard memblokir fitur berat LMS ketika ujian massal sedang berlangsung
func ExamLockdownGuard(rdb *redis.Client) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if rdb == nil {
			return c.Next()
		}

		ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
		defer cancel()

		val, err := rdb.Get(ctx, cache.KeyLockdownMode).Result()
		if err == nil && val == "1" {
			// Periksa apakah user adalah Admin atau Proktor (dikecualikan dari pembatasan)
			if claims, ok := c.Locals("user").(*core.JWTClaims); ok && claims != nil {
				if claims.Role == core.RoleAdmin || claims.Role == core.RoleProctor {
					return c.Next()
				}
			}

			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
				"status":  "error",
				"code":    "EXAM_LOCKDOWN_ACTIVE",
				"message": "Fitur ini sementara dinonaktifkan karena Ujian Massal sedang berlangsung untuk menjaga kestabilan server.",
			})
		}

		return c.Next()
	}
}

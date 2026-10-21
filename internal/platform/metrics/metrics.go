package metrics

import (
	"context"
	"runtime"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type MetricsHandler struct {
	pool *pgxpool.Pool
	rdb  *redis.Client
}

func NewMetricsHandler(pool *pgxpool.Pool, rdb *redis.Client) *MetricsHandler {
	return &MetricsHandler{pool: pool, rdb: rdb}
}

// GetSystemMetrics mengembalikan metrik kesehatan server secara super ringan (< 2 ms)
func (h *MetricsHandler) GetSystemMetrics(c *fiber.Ctx) error {
	var m runtime.MemStats
	runtime.ReadMemStats(&m)

	ctx, cancel := context.WithTimeout(c.Context(), 1*time.Second)
	defer cancel()

	activeStudents := 0
	dirtySessions := 0

	if h.rdb != nil {
		// Hitung siswa aktif dari keys presence atau dirty sessions
		if dirtyKeys, err := h.rdb.Keys(ctx, "cbt:dirty_sessions:*").Result(); err == nil {
			for _, k := range dirtyKeys {
				if count, err := h.rdb.SCard(ctx, k).Result(); err == nil {
					dirtySessions += int(count)
				}
			}
		}

		if presenceKeys, err := h.rdb.Keys(ctx, "cbt:presence:*").Result(); err == nil {
			for _, k := range presenceKeys {
				// Siswa aktif dalam 2 menit terakhir
				minScore := float64(time.Now().Add(-2 * time.Minute).Unix())
				if count, err := h.rdb.ZCount(ctx, k, fmtScore(minScore), "+inf").Result(); err == nil {
					activeStudents += int(count)
				}
			}
		}
	}

	var acquiredConns int32 = 0
	var maxConns int32 = 0
	if h.pool != nil {
		stat := h.pool.Stat()
		acquiredConns = stat.AcquiredConns()
		maxConns = stat.MaxConns()
	}

	return c.JSON(fiber.Map{
		"status":                       "success",
		"ram_alloc_mb":                 float64(m.Alloc) / 1024 / 1024,
		"ram_sys_mb":                   float64(m.Sys) / 1024 / 1024,
		"num_goroutines":               runtime.NumGoroutine(),
		"active_exam_students":         activeStudents,
		"pending_redis_dirty_sessions": dirtySessions,
		"pg_pool_acquired_conns":       acquiredConns,
		"pg_pool_max_conns":            maxConns,
		"server_time":                  time.Now().Format(time.RFC3339),
	})
}

func fmtScore(score float64) string {
	return string([]byte(time.Unix(int64(score), 0).Format("1136239445")))
}

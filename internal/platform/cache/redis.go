package cache

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"cbt-lms-ai/internal/config"
	"github.com/redis/go-redis/v9"
)

type RedisClient struct {
	Client *redis.Client
}

func NewRedisClient(cfg *config.Config) (*RedisClient, error) {
	rdb := redis.NewClient(&redis.Options{
		Addr:         cfg.RedisAddr,
		Password:     cfg.RedisPassword,
		DB:           cfg.RedisDB,
		PoolSize:     100, // Cukup besar untuk menangani antrean request 1.700 siswa
		MinIdleConns: 20,
		DialTimeout:  3 * time.Second,
		ReadTimeout:  2 * time.Second,
		WriteTimeout: 2 * time.Second,
		PoolTimeout:  3 * time.Second,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	if err := rdb.Ping(ctx).Err(); err != nil {
		slog.Warn("Redis ping warning saat inisialisasi awal (pastikan Redis aktif):", "err", err)
	} else {
		slog.Info("Koneksi Redis berhasil tersambung", "addr", cfg.RedisAddr)
	}

	return &RedisClient{Client: rdb}, nil
}

func (r *RedisClient) Close() error {
	if r.Client != nil {
		return r.Client.Close()
	}
	return nil
}

// Helper Keys CBT & Lockdown Sesuai database.md
const (
	KeyLockdownMode = "sys:lockdown_mode"
)

func ExamKeyPattern(scheduleID int) string {
	return fmt.Sprintf("cbt:key:%d", scheduleID)
}

func StudentAnswerKey(scheduleID int, studentID int64) string {
	return fmt.Sprintf("cbt:ans:%d:%d", scheduleID, studentID)
}

func DirtySessionsKey(scheduleID int) string {
	return fmt.Sprintf("cbt:dirty_sessions:%d", scheduleID)
}

func PresenceKey(scheduleID int) string {
	return fmt.Sprintf("cbt:presence:%d", scheduleID)
}

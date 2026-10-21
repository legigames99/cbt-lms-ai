package database

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"cbt-lms-ai/internal/config"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PostgresPool struct {
	Pool *pgxpool.Pool
}

func NewPostgresPool(cfg *config.Config) (*PostgresPool, error) {
	dsn := fmt.Sprintf(
		"postgres://%s:%s@%s:%s/%s?sslmode=%s",
		cfg.DBUser,
		cfg.DBPassword,
		cfg.DBHost,
		cfg.DBPort,
		cfg.DBName,
		cfg.DBSSLMode,
	)

	poolConfig, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("gagal parse postgres DSN: %w", err)
	}

	// Konfigurasi pool untuk server 4 Core / 4GB RAM (80 max conns sesuai requirements.md)
	poolConfig.MaxConns = cfg.DBPoolMaxConns
	poolConfig.MinConns = cfg.DBPoolMinConns
	poolConfig.MaxConnIdleTime = 5 * time.Minute
	poolConfig.MaxConnLifetime = 30 * time.Minute
	poolConfig.HealthCheckPeriod = 1 * time.Minute

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	pool, err := pgxpool.NewWithConfig(ctx, poolConfig)
	if err != nil {
		return nil, fmt.Errorf("gagal membuat pool koneksi database: %w", err)
	}

	// Tes koneksi
	if err := pool.Ping(ctx); err != nil {
		slog.Warn("PostgreSQL ping warning saat inisialisasi awal (pastikan DB aktif):", "err", err)
	} else {
		slog.Info("Koneksi PostgreSQL berhasil tersambung", "max_conns", cfg.DBPoolMaxConns, "database", cfg.DBName)
	}

	return &PostgresPool{Pool: pool}, nil
}

func (p *PostgresPool) Close() {
	if p.Pool != nil {
		p.Pool.Close()
	}
}

package config

import (
	"log/slog"
	"os"
	"runtime/debug"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	AppEnv           string
	AppPort          string
	GoMemLimit       string
	JWTSecret        string
	StaticPackageDir string

	// Database
	DBHost         string
	DBPort         string
	DBUser         string
	DBPassword     string
	DBName         string
	DBSSLMode      string
	DBPoolMaxConns int32
	DBPoolMinConns int32

	// Redis
	RedisAddr     string
	RedisPassword string
	RedisDB       int

	// AI
	AIProvider string
	AIAPIKey   string
	AIModel    string

	// Storage (R2 / S3)
	R2AccountID       string
	R2AccessKeyID     string
	R2SecretAccessKey string
	R2BucketName      string
	R2PublicDomain    string
}

func LoadConfig() *Config {
	// Muat file .env jika ada (tidak wajib di environment container/VPS)
	_ = godotenv.Load()

	cfg := &Config{
		AppEnv:           getEnv("APP_ENV", "production"),
		AppPort:          getEnv("APP_PORT", "8080"),
		GoMemLimit:       getEnv("GOMEMLIMIT", "250MiB"),
		JWTSecret:        getEnv("JWT_SECRET", "default_secret_key_change_in_production_32char"),
		StaticPackageDir: getEnv("STATIC_PACKAGE_DIR", "./static/packages"),

		DBHost:         getEnv("DB_HOST", "127.0.0.1"),
		DBPort:         getEnv("DB_PORT", "5432"),
		DBUser:         getEnv("DB_USER", "cbt_user"),
		DBPassword:     getEnv("DB_PASSWORD", "secret_cbt_pass"),
		DBName:         getEnv("DB_NAME", "cbt_lms_db"),
		DBSSLMode:      getEnv("DB_SSLMODE", "disable"),
		DBPoolMaxConns: getEnvInt32("DB_POOL_MAX_CONNS", 80),
		DBPoolMinConns: getEnvInt32("DB_POOL_MIN_CONNS", 10),

		RedisAddr:     getEnv("REDIS_ADDR", "127.0.0.1:6379"),
		RedisPassword: getEnv("REDIS_PASSWORD", ""),
		RedisDB:       getEnvInt("REDIS_DB", 0),

		AIProvider: getEnv("AI_PROVIDER", "gemini"),
		AIAPIKey:   getEnv("AI_API_KEY", ""),
		AIModel:    getEnv("AI_MODEL", "gemini-2.5-flash"),

		R2AccountID:       getEnv("R2_ACCOUNT_ID", ""),
		R2AccessKeyID:     getEnv("R2_ACCESS_KEY_ID", ""),
		R2SecretAccessKey: getEnv("R2_SECRET_ACCESS_KEY", ""),
		R2BucketName:      getEnv("R2_BUCKET_NAME", "school-cbt-lms"),
		R2PublicDomain:    getEnv("R2_PUBLIC_DOMAIN", ""),
	}

	// Terapkan GOMEMLIMIT ke Go GC Runtime
	applyMemoryLimit(cfg.GoMemLimit)

	return cfg
}

func applyMemoryLimit(limitStr string) {
	limitStr = strings.TrimSpace(limitStr)
	var bytes int64

	switch {
	case strings.HasSuffix(limitStr, "GiB"):
		val, _ := strconv.ParseInt(strings.TrimSuffix(limitStr, "GiB"), 10, 64)
		bytes = val * 1024 * 1024 * 1024
	case strings.HasSuffix(limitStr, "MiB"):
		val, _ := strconv.ParseInt(strings.TrimSuffix(limitStr, "MiB"), 10, 64)
		bytes = val * 1024 * 1024
	case strings.HasSuffix(limitStr, "KiB"):
		val, _ := strconv.ParseInt(strings.TrimSuffix(limitStr, "KiB"), 10, 64)
		bytes = val * 1024
	default:
		bytes, _ = strconv.ParseInt(limitStr, 10, 64)
	}

	if bytes > 0 {
		oldLimit := debug.SetMemoryLimit(bytes)
		slog.Info("Go runtime memory limit applied", "limit_bytes", bytes, "limit_str", limitStr, "old_limit_bytes", oldLimit)
	}
}

func getEnv(key, defaultVal string) string {
	if val, ok := os.LookupEnv(key); ok && val != "" {
		return val
	}
	return defaultVal
}

func getEnvInt(key string, defaultVal int) int {
	if val, ok := os.LookupEnv(key); ok {
		if i, err := strconv.Atoi(val); err == nil {
			return i
		}
	}
	return defaultVal
}

func getEnvInt32(key string, defaultVal int32) int32 {
	if val, ok := os.LookupEnv(key); ok {
		if i, err := strconv.ParseInt(val, 10, 32); err == nil {
			return int32(i)
		}
	}
	return defaultVal
}

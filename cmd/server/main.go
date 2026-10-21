package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"

	"cbt-lms-ai/internal/ai"
	"cbt-lms-ai/internal/cbt"
	"cbt-lms-ai/internal/config"
	"cbt-lms-ai/internal/core"
	"cbt-lms-ai/internal/lms"
	"cbt-lms-ai/internal/platform/cache"
	"cbt-lms-ai/internal/platform/database"
	"cbt-lms-ai/internal/platform/metrics"
	"cbt-lms-ai/internal/platform/middleware"
	"cbt-lms-ai/internal/platform/storage"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/recover"
)

func main() {
	// Parse CLI command flags
	cmdFlag := flag.String("cmd", "serve", "Perintah: serve | flush-redis-to-pg | healthcheck | migrate | seed")
	flag.Parse()

	// 1. Inisialisasi Structured JSON Logger (slog)
	jsonHandler := slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})
	slog.SetDefault(slog.New(jsonHandler))

	// 2. Muat Konfigurasi Lingkungan & Limit RAM
	cfg := config.LoadConfig()

	// 3. Inisialisasi Database Pool & In-Memory Redis
	pgPool, err := database.NewPostgresPool(cfg)
	if err != nil {
		slog.Error("Inisialisasi database PostgreSQL gagal", "err", err)
	}
	defer pgPool.Close()

	redisClient, err := cache.NewRedisClient(cfg)
	if err != nil {
		slog.Error("Inisialisasi Redis gagal", "err", err)
	}
	defer func() { _ = redisClient.Close() }()

	// 4. Inisialisasi Storage Provider & Services
	storageProvider := storage.NewStorageProvider(cfg)
	tokenService := core.NewTokenService(cfg.JWTSecret)
	cbtPackager := cbt.NewPackager(pgPool.Pool, redisClient.Client, cfg.StaticPackageDir)
	cbtBatchWorker := cbt.NewBatchWorker(pgPool.Pool, redisClient.Client, 20*time.Second)

	migrator := database.NewMigrator(pgPool.Pool)

	// Mode CLI: Manual Flush Redis ke PostgreSQL
	if *cmdFlag == "flush-redis-to-pg" {
		slog.Info("Memulai CLI: Flush data jawaban Redis ke PostgreSQL...")
		cbtBatchWorker.FlushAllDirtySessions()
		slog.Info("Selesai flush jawaban ke PostgreSQL.")
		return
	}

	// Mode CLI: Healthcheck
	if *cmdFlag == "healthcheck" {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := pgPool.Pool.Ping(ctx); err != nil {
			fmt.Printf("Database: ERROR (%v)\n", err)
			os.Exit(1)
		}
		if err := redisClient.Client.Ping(ctx).Err(); err != nil {
			fmt.Printf("Redis: ERROR (%v)\n", err)
			os.Exit(1)
		}
		fmt.Println("Sistem Sehat: Database dan Redis terhubung dengan baik.")
		return
	}

	// Otomasi Migrasi Database & Seeding Data Awal jika diperlukan
	initCtx, initCancel := context.WithTimeout(context.Background(), 10*time.Second)
	if pgPool != nil && pgPool.Pool != nil {
		if err := pgPool.Pool.Ping(initCtx); err == nil {
			// Jalankan DDL jika file migrasi ditemukan
			if _, err := os.Stat("migrations/001_init_schemas.sql"); err == nil {
				_ = migrator.AutoMigrate(initCtx, "migrations/001_init_schemas.sql")
			}
			// Jalankan Seeding data awal otomatis
			_ = migrator.SeedInitialData(initCtx)

			// Kompilasi paket soal terenkripsi pertama jika belum ada
			pkgFile := filepath.Join(cfg.StaticPackageDir, "exam_1_enc.json")
			if _, err := os.Stat(pkgFile); os.IsNotExist(err) {
				slog.Info("Mengompilasi dan mengenkripsi paket soal ujian perdana (AES-256-GCM)...")
				_, err := cbtPackager.BuildAndEncryptExamPackage(initCtx, 1)
				if err != nil {
					slog.Warn("Belum dapat mengompilasi paket soal otomatis:", "err", err)
				}
			}
		}
	}
	initCancel()

	if *cmdFlag == "migrate" || *cmdFlag == "seed" {
		slog.Info("Perintah migrasi/seeding selesai dijalankan.")
		return
	}

	// Mulai CBT Batch Worker di background
	cbtBatchWorker.Start()
	defer cbtBatchWorker.Stop()

	// Inisialisasi AI & Handlers
	aiClient := ai.NewAIClient(cfg)
	aiQueueWorker := ai.NewAIQueueWorker(pgPool.Pool, aiClient)

	coreRepo := core.NewRepository(pgPool.Pool)
	authHandler := core.NewAuthHandler(coreRepo, tokenService, redisClient.Client)

	cbtRepo := cbt.NewRepository(pgPool.Pool)
	cbtHandler := cbt.NewCBTHandler(cbtRepo, cbtPackager, cbtBatchWorker, redisClient.Client)

	lmsRepo := lms.NewRepository(pgPool.Pool)
	lmsHandler := lms.NewLMSHandler(lmsRepo, storageProvider, redisClient.Client)

	metricsHandler := metrics.NewMetricsHandler(pgPool.Pool, redisClient.Client)

	// 5. Inisialisasi Web Framework Fiber v2
	app := fiber.New(fiber.Config{
		DisableStartupMessage: true,
		AppName:               "CBT & LMS AI High-Concurrency Server v1.0",
		ReadTimeout:           10 * time.Second,
		WriteTimeout:          10 * time.Second,
		IdleTimeout:           60 * time.Second,
	})

	app.Use(recover.New())
	app.Use(cors.New(cors.Config{
		AllowOrigins:     "*",
		AllowHeaders:     "Origin, Content-Type, Accept, Authorization",
		AllowMethods:     "GET, POST, PUT, DELETE, OPTIONS",
		AllowCredentials: true,
	}))

	// Static Package serving & Frontend Routing
	app.Static("/static/packages", cfg.StaticPackageDir)
	app.Static("/", "./web")

	// Routing Halaman Frontend Web SPA
	app.Get("/dashboard", func(c *fiber.Ctx) error {
		return c.SendFile("./web/dashboard.html")
	})
	app.Get("/teacher", func(c *fiber.Ctx) error {
		return c.SendFile("./web/dashboard.html")
	})
	app.Get("/admin", func(c *fiber.Ctx) error {
		return c.SendFile("./web/dashboard.html")
	})
	app.Get("/exam", func(c *fiber.Ctx) error {
		return c.SendFile("./web/student.html")
	})

	// 6. Registrasi Rute API (/api/v1)
	api := app.Group("/api/v1")

	// Metrik & Health
	api.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"status": "ok", "time": time.Now().Unix()})
	})
	api.Get("/system/metrics", metricsHandler.GetSystemMetrics)

	// Auth
	auth := api.Group("/auth")
	auth.Post("/login", authHandler.HandleLogin)
	auth.Get("/me", middleware.AuthGuard(tokenService), authHandler.HandleGetMe)

	// CBT Mesin Ujian
	cbtRoutes := api.Group("/cbt", middleware.AuthGuard(tokenService))
	cbtRoutes.Get("/schedules/active", cbtHandler.GetActiveSchedule)
	cbtRoutes.Post("/schedules/:schedule_id/start", cbtHandler.StartExam)
	cbtRoutes.Post("/schedules/:schedule_id/sync", cbtHandler.SyncAnswers)
	cbtRoutes.Post("/schedules/:schedule_id/finish", cbtHandler.FinishExam)
	cbtRoutes.Post("/schedules/:schedule_id/publish-package",
		middleware.RequireRole(core.RoleAdmin, core.RoleTeacher),
		cbtHandler.PublishExamPackage,
	)

	// AI Generator (Guarded by ExamLockdownGuard)
	aiRoutes := api.Group("/ai", middleware.AuthGuard(tokenService), middleware.ExamLockdownGuard(redisClient.Client))
	aiHandler := ai.NewAIHandler(aiQueueWorker)
	aiRoutes.Post("/generate-questions", middleware.RequireRole(core.RoleAdmin, core.RoleTeacher), aiHandler.GenerateQuestions)
	aiRoutes.Get("/jobs/:id/events", aiHandler.StreamJobEvents)

	// LMS (Guarded by ExamLockdownGuard)
	lmsRoutes := api.Group("/lms", middleware.AuthGuard(tokenService), middleware.ExamLockdownGuard(redisClient.Client))
	lmsRoutes.Post("/storage/presign-upload", lmsHandler.GeneratePresignedUpload)
	lmsRoutes.Get("/courses/:course_id/materials", lmsHandler.GetMaterials)
	lmsRoutes.Post("/courses/:course_id/materials", middleware.RequireRole(core.RoleAdmin, core.RoleTeacher), lmsHandler.CreateMaterial)
	lmsRoutes.Post("/assignments/:assignment_id/submit", middleware.RequireRole(core.RoleStudent), lmsHandler.SubmitAssignment)
	lmsRoutes.Get("/courses/:course_id/gradebook", lmsHandler.GetGradebook)

	// Admin
	adminRoutes := api.Group("/admin", middleware.AuthGuard(tokenService), middleware.RequireRole(core.RoleAdmin))
	adminRoutes.Post("/lockdown/toggle", lmsHandler.ToggleLockdownMode)

	// 7. Menjalankan Server & Graceful Shutdown
	go func() {
		listenAddr := fmt.Sprintf(":%s", cfg.AppPort)
		slog.Info("Server CBT & LMS AI aktif dan siap melayani 1.700 siswa", "url", fmt.Sprintf("http://localhost:%s", cfg.AppPort))
		if err := app.Listen(listenAddr); err != nil {
			slog.Error("Server listen error", "err", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	slog.Info("Sinyal shutdown diterima. Menghentikan server...")
	_ = app.ShutdownWithTimeout(5 * time.Second)
	slog.Info("Server berhasil dinonaktifkan.")
}

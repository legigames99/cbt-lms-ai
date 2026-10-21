package cbt

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"cbt-lms-ai/internal/platform/cache"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type Packager struct {
	pool             *pgxpool.Pool
	rdb              *redis.Client
	staticPackageDir string
}

func NewPackager(pool *pgxpool.Pool, rdb *redis.Client, packageDir string) *Packager {
	_ = os.MkdirAll(packageDir, 0755)
	return &Packager{
		pool:             pool,
		rdb:              rdb,
		staticPackageDir: packageDir,
	}
}

// EncryptedPackageFormat adalah format berkas JSON terenkripsi yang diunduh oleh klien
type EncryptedPackageFormat struct {
	ScheduleID int    `json:"schedule_id"`
	Title      string `json:"title"`
	NonceHex   string `json:"nonce"`
	CipherHex  string `json:"ciphertext"`
}

// BuildAndEncryptExamPackage mengompilasi bank soal menjadi paket terenkripsi AES-256-GCM
func (p *Packager) BuildAndEncryptExamPackage(ctx context.Context, scheduleID int) (*ExamSchedule, error) {
	// 1. Ambil detail jadwal ujian
	var schedule ExamSchedule
	scheduleQuery := `
		SELECT id, bank_id, title, token_code, start_time, end_time, duration_minutes, status, shuffle_questions, shuffle_options
		FROM cbt.exam_schedules
		WHERE id = $1;
	`
	err := p.pool.QueryRow(ctx, scheduleQuery, scheduleID).Scan(
		&schedule.ID,
		&schedule.BankID,
		&schedule.Title,
		&schedule.TokenCode,
		&schedule.StartTime,
		&schedule.EndTime,
		&schedule.DurationMinutes,
		&schedule.Status,
		&schedule.ShuffleQuestions,
		&schedule.ShuffleOptions,
	)
	if err != nil {
		return nil, fmt.Errorf("gagal mengambil jadwal ujian: %w", err)
	}

	// 2. Ambil seluruh butir soal tanpa kunci jawaban dan pembahasan
	questionsQuery := `
		SELECT id, question_type, COALESCE(cognitive_level, ''), stem_html, options_json, score_weight
		FROM cbt.questions
		WHERE bank_id = $1
		ORDER BY id ASC;
	`
	rows, err := p.pool.Query(ctx, questionsQuery, schedule.BankID)
	if err != nil {
		return nil, fmt.Errorf("gagal mengambil soal: %w", err)
	}
	defer rows.Close()

	var clientQuestions []ClientQuestion
	for rows.Next() {
		var q ClientQuestion
		var typeStr string
		var optBytes []byte

		if err := rows.Scan(&q.ID, &typeStr, &q.CognitiveLevel, &q.StemHTML, &optBytes, &q.ScoreWeight); err != nil {
			return nil, fmt.Errorf("scan soal gagal: %w", err)
		}
		q.QuestionType = QuestionType(typeStr)
		q.Options = json.RawMessage(optBytes)
		clientQuestions = append(clientQuestions, q)
	}

	// 3. Serialize ke JSON polos
	plainPayload, err := json.Marshal(map[string]interface{}{
		"schedule_id":       schedule.ID,
		"title":             schedule.Title,
		"duration_minutes":  schedule.DurationMinutes,
		"shuffle_questions": schedule.ShuffleQuestions,
		"shuffle_options":   schedule.ShuffleOptions,
		"questions":         clientQuestions,
	})
	if err != nil {
		return nil, fmt.Errorf("gagal serialize json soal: %w", err)
	}

	// 4. Generate Kunci AES-256 (32 Bytes)
	keyBytes := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, keyBytes); err != nil {
		return nil, fmt.Errorf("gagal generate AES key: %w", err)
	}
	keyHex := hex.EncodeToString(keyBytes)

	// 5. Enkripsi AES-256-GCM
	block, err := aes.NewCipher(keyBytes)
	if err != nil {
		return nil, fmt.Errorf("gagal inisialisasi cipher AES: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, fmt.Errorf("gagal inisialisasi GCM: %w", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return nil, fmt.Errorf("gagal generate nonce: %w", err)
	}

	ciphertext := gcm.Seal(nil, nonce, plainPayload, nil)

	// 6. Tulis file JSON terenkripsi ke direktori statis
	packageFileName := fmt.Sprintf("exam_%d_enc.json", schedule.ID)
	targetFilePath := filepath.Join(p.staticPackageDir, packageFileName)

	packageData, err := json.Marshal(EncryptedPackageFormat{
		ScheduleID: schedule.ID,
		Title:      schedule.Title,
		NonceHex:   hex.EncodeToString(nonce),
		CipherHex:  hex.EncodeToString(ciphertext),
	})
	if err != nil {
		return nil, fmt.Errorf("gagal serialize encrypted package: %w", err)
	}

	if err := os.WriteFile(targetFilePath, packageData, 0644); err != nil {
		return nil, fmt.Errorf("gagal menulis file paket soal ke disk: %w", err)
	}

	// Hitung checksum SHA-256
	h := sha256.Sum256(packageData)
	sha256Hex := hex.EncodeToString(h[:])

	// 7. Simpan path dan kunci ke PostgreSQL
	updateQuery := `
		UPDATE cbt.exam_schedules
		SET package_file_path = $1,
		    encryption_key_hex = $2,
		    status = 'published'
		WHERE id = $3;
	`
	relPath := fmt.Sprintf("/static/packages/%s", packageFileName)
	if _, err := p.pool.Exec(ctx, updateQuery, relPath, keyHex, schedule.ID); err != nil {
		return nil, fmt.Errorf("gagal mengupdate status jadwal di DB: %w", err)
	}

	// 8. Cache Kunci Dekripsi di Redis In-Memory agar siap melayani 1.700 siswa instan
	if p.rdb != nil {
		redisKey := cache.ExamKeyPattern(schedule.ID)
		_ = p.rdb.Set(ctx, redisKey, keyHex, 0).Err()
	}

	schedule.PackageFilePath = relPath
	schedule.PackageSHA256 = sha256Hex
	schedule.EncryptionKeyHex = keyHex
	schedule.Status = "published"

	return &schedule, nil
}

package storage

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/url"
	"path"
	"strings"
	"time"

	"cbt-lms-ai/internal/config"
)

type StorageProvider interface {
	GeneratePresignedUploadURL(objectKey, contentType string, expiresIn time.Duration) (string, error)
	GetPublicURL(objectKey string) string
}

type S3R2Storage struct {
	cfg *config.Config
}

func NewStorageProvider(cfg *config.Config) StorageProvider {
	return &S3R2Storage{cfg: cfg}
}

// GeneratePresignedUploadURL membuat Presigned URL upload langsung ke Cloudflare R2 / S3
func (s *S3R2Storage) GeneratePresignedUploadURL(objectKey, contentType string, expiresIn time.Duration) (string, error) {
	cleanKey := strings.TrimPrefix(path.Clean("/"+objectKey), "/")

	// Jika akun R2 belum diisi, sediakan endpoint fallback internal untuk pengujian lokal
	if s.cfg.R2AccountID == "" || s.cfg.R2AccessKeyID == "" {
		return fmt.Sprintf("http://localhost:%s/api/v1/lms/storage/mock-upload/%s", s.cfg.AppPort, cleanKey), nil
	}

	endpoint := fmt.Sprintf("https://%s.r2.cloudflarestorage.com", s.cfg.R2AccountID)
	bucket := s.cfg.R2BucketName
	now := time.Now().UTC()
	datestamp := now.Format("20060102")
	amzdate := now.Format("20060102T150405Z")
	credential := fmt.Sprintf("%s/%s/auto/s3/aws4_request", s.cfg.R2AccessKeyID, datestamp)

	expiresSeconds := int(expiresIn.Seconds())
	if expiresSeconds <= 0 {
		expiresSeconds = 600
	}

	rawQuery := fmt.Sprintf(
		"X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=%s&X-Amz-Date=%s&X-Amz-Expires=%d&X-Amz-SignedHeaders=host",
		url.QueryEscape(credential),
		amzdate,
		expiresSeconds,
	)

	canonicalURI := fmt.Sprintf("/%s/%s", bucket, cleanKey)
	canonicalHeaders := fmt.Sprintf("host:%s.r2.cloudflarestorage.com\n", s.cfg.R2AccountID)
	canonicalRequest := fmt.Sprintf("PUT\n%s\n%s\n%s\nhost\nUNSIGNED-PAYLOAD", canonicalURI, rawQuery, canonicalHeaders)

	hReq := sha256.Sum256([]byte(canonicalRequest))
	hashedReq := hex.EncodeToString(hReq[:])

	stringToSign := fmt.Sprintf("AWS4-HMAC-SHA256\n%s\n%s/auto/s3/aws4_request\n%s", amzdate, datestamp, hashedReq)

	kDate := hmacSHA256([]byte("AWS4"+s.cfg.R2SecretAccessKey), datestamp)
	kRegion := hmacSHA256(kDate, "auto")
	kService := hmacSHA256(kRegion, "s3")
	kSigning := hmacSHA256(kService, "aws4_request")
	signature := hex.EncodeToString(hmacSHA256(kSigning, stringToSign))

	presignedURL := fmt.Sprintf("%s%s?%s&X-Amz-Signature=%s", endpoint, canonicalURI, rawQuery, signature)
	return presignedURL, nil
}

func (s *S3R2Storage) GetPublicURL(objectKey string) string {
	cleanKey := strings.TrimPrefix(path.Clean("/"+objectKey), "/")
	if s.cfg.R2PublicDomain != "" {
		return fmt.Sprintf("%s/%s", strings.TrimSuffix(s.cfg.R2PublicDomain, "/"), cleanKey)
	}
	return fmt.Sprintf("https://%s.r2.cloudflarestorage.com/%s/%s", s.cfg.R2AccountID, s.cfg.R2BucketName, cleanKey)
}

func hmacSHA256(key []byte, data string) []byte {
	h := hmac.New(sha256.New, key)
	h.Write([]byte(data))
	return h.Sum(nil)
}

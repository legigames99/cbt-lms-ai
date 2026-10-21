package cbt

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"io"
	"testing"

	"cbt-lms-ai/internal/core"
)

// TestAES256GCMEncryptionRoundtrip memverifikasi enkripsi paket soal AES-256-GCM
func TestAES256GCMEncryptionRoundtrip(t *testing.T) {
	keyBytes := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, keyBytes); err != nil {
		t.Fatalf("Gagal generate key: %v", err)
	}

	plainText := []byte(`{"title":"UAS Fisika Peminatan XII","questions":[{"id":1,"stem":"Soal 1"}]}`)

	block, err := aes.NewCipher(keyBytes)
	if err != nil {
		t.Fatalf("NewCipher gagal: %v", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatalf("NewGCM gagal: %v", err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		t.Fatalf("Nonce gagal: %v", err)
	}

	ciphertext := gcm.Seal(nil, nonce, plainText, nil)

	// Dekripsi kembali
	decrypted, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		t.Fatalf("Dekripsi gagal: %v", err)
	}

	if string(decrypted) != string(plainText) {
		t.Errorf("Hasil dekripsi tidak cocok. Diharapkan: %s, Didapat: %s", string(plainText), string(decrypted))
	}
}

// TestJWTStatelessAuth memverifikasi pembuatan token JWT dan validasi stateless tanpa query DB
func TestJWTStatelessAuth(t *testing.T) {
	secret := "secret_key_panjang_32_karakter_aman!"
	tokenService := core.NewTokenService(secret)

	u := &core.User{
		ID:        1042,
		Username:  "siswa_1001",
		FullName:  "Budi Santoso",
		Role:      core.RoleStudent,
		ClassName: "XII IPA 1",
	}

	tokenStr, expiresIn, err := tokenService.GenerateAccessToken(u)
	if err != nil {
		t.Fatalf("Generate token gagal: %v", err)
	}

	if expiresIn != 28800 {
		t.Errorf("Expired waktu tidak sesuai: %d", expiresIn)
	}

	claims, err := tokenService.ValidateToken(tokenStr)
	if err != nil {
		t.Fatalf("Validasi token gagal: %v", err)
	}

	if claims.UserID != 1042 || claims.Username != "siswa_1001" || claims.Role != core.RoleStudent {
		t.Errorf("Klaim JWT tidak cocok dengan pengguna: %+v", claims)
	}
}

// TestJSONSerializationPayload memverifikasi serialization payload jawaban
func TestJSONSerializationPayload(t *testing.T) {
	p := SingleAnswerPayload{
		Ans:       "B",
		IsDoubt:   0,
		Timestamp: 1730000000,
	}

	str := SerializeAnswerPayload(p)
	var decoded SingleAnswerPayload
	if err := json.Unmarshal([]byte(str), &decoded); err != nil {
		t.Fatalf("Gagal unmarshal: %v", err)
	}

	if decoded.Ans != "B" || decoded.IsDoubt != 0 {
		t.Errorf("Payload mismatch: %+v", decoded)
	}
}

// Dummy helper untuk validasi hex key
func TestHexKeyFormat(t *testing.T) {
	rawKey := make([]byte, 32)
	hexStr := hex.EncodeToString(rawKey)
	if len(hexStr) != 64 {
		t.Errorf("Panjang hex AES-256 harus tepat 64 karakter, didapat: %d", len(hexStr))
	}
}

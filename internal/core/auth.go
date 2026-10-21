package core

import (
	"errors"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

type JWTClaims struct {
	UserID    int64  `json:"uid"`
	Username  string `json:"usr"`
	FullName  string `json:"fn"`
	Role      Role   `json:"rol"`
	ClassID   *int   `json:"cid,omitempty"`
	ClassName string `json:"cn,omitempty"`
	jwt.RegisteredClaims
}

type TokenService struct {
	secretKey []byte
}

func NewTokenService(secret string) *TokenService {
	return &TokenService{secretKey: []byte(secret)}
}

// GenerateAccessToken membuat token JWT stateless (berlaku 8 jam / 28800 detik)
func (s *TokenService) GenerateAccessToken(user *User) (string, int, error) {
	expiresIn := 28800 // 8 jam
	expirationTime := time.Now().Add(time.Duration(expiresIn) * time.Second)

	claims := &JWTClaims{
		UserID:    user.ID,
		Username:  user.Username,
		FullName:  user.FullName,
		Role:      user.Role,
		ClassID:   user.ClassID,
		ClassName: user.ClassName,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expirationTime),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    "cbt-lms-ai",
		},
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	tokenString, err := token.SignedString(s.secretKey)
	if err != nil {
		return "", 0, err
	}

	return tokenString, expiresIn, nil
}

// ValidateToken memvalidasi signature token tanpa query database (Stateless)
func (s *TokenService) ValidateToken(tokenStr string) (*JWTClaims, error) {
	token, err := jwt.ParseWithClaims(tokenStr, &JWTClaims{}, func(token *jwt.Token) (interface{}, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, errors.New("algoritma signing token tidak valid")
		}
		return s.secretKey, nil
	})

	if err != nil {
		return nil, err
	}

	if claims, ok := token.Claims.(*JWTClaims); ok && token.Valid {
		return claims, nil
	}

	return nil, errors.New("token tidak valid atau telah kadaluarsa")
}

// CheckPassword memvalidasi kecocokan password polos dengan bcrypt hash
func CheckPassword(password, hash string) bool {
	err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password))
	return err == nil
}

// HashPassword membuat bcrypt hash dari password polos
func HashPassword(password string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(bytes), err
}

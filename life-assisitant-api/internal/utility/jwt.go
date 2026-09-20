// Package utility 提供 JWT 签发 / 校验工具
// 规范见 ../life-assisitant/md/spec/30-后端架构.md §8
package utility

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// Claims 自定义 JWT 声明
type Claims struct {
	UserID    string `json:"user_id"`
	Role      string `json:"role"`
	DeviceID  string `json:"device_id"`
	TokenType string `json:"token_type"` // access / refresh
	jwt.RegisteredClaims
}

// TokenType 枚举
const (
	TokenTypeAccess  = "access"
	TokenTypeRefresh = "refresh"
)

// JWTConfig JWT 配置（从 yaml 注入）
type JWTConfig struct {
	AccessSecret  string
	RefreshSecret string
	AccessTTL     int // 秒
	RefreshTTL    int
	Issuer        string
}

// Config 全局 JWT 配置（由 main.go 启动时加载）
var Config JWTConfig

// LoadConfig 加载配置（main.go 调用）
func LoadConfig(c JWTConfig) {
	Config = c
}

// GenerateAccessToken 签发 access_token
func GenerateAccessToken(userID, role, deviceID string) (string, int, error) {
	ttl := Config.AccessTTL
	if ttl == 0 {
		ttl = 900
	}
	claims := Claims{
		UserID:    userID,
		Role:      role,
		DeviceID:  deviceID,
		TokenType: TokenTypeAccess,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Duration(ttl) * time.Second)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    configIssuer(),
			Subject:   userID,
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(Config.AccessSecret))
	return signed, ttl, err
}

// GenerateRefreshToken 签发 refresh_token
func GenerateRefreshToken(userID, deviceID string) (string, time.Time, error) {
	ttl := Config.RefreshTTL
	if ttl == 0 {
		ttl = 7 * 24 * 3600
	}
	expires := time.Now().Add(time.Duration(ttl) * time.Second)
	claims := Claims{
		UserID:    userID,
		DeviceID:  deviceID,
		TokenType: TokenTypeRefresh,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expires),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			Issuer:    configIssuer(),
			Subject:   userID,
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString([]byte(Config.RefreshSecret))
	return signed, expires, err
}

// ParseToken 解析并校验 token
// isAccess=true 用 access_secret 校验；否则用 refresh_secret
func ParseToken(tokenStr string, isAccess bool) (*Claims, error) {
	secret := Config.RefreshSecret
	if isAccess {
		secret = Config.AccessSecret
	}
	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(secret), nil
	})
	if err != nil {
		return nil, err
	}
	if !token.Valid {
		return nil, errors.New("invalid token")
	}
	return claims, nil
}

// HashToken SHA-256 哈希 token 用于持久化（不存明文）
func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func configIssuer() string {
	if Config.Issuer == "" {
		return "life-assistant"
	}
	return Config.Issuer
}

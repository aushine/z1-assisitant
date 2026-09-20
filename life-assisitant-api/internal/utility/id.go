package utility

import (
	"crypto/rand"
	"encoding/hex"

	"github.com/google/uuid"
)

// NewID 生成业务 ID（前缀 + 16 字节 hex）
// 如 NewID("u") → "u_a1b2c3d4e5f60718"
func NewID(prefix string) string {
	id := uuid.New().String()
	// 去掉短横线，取前 16 字符
	clean := ""
	for _, c := range id {
		if c == '-' {
			continue
		}
		clean += string(c)
		if len(clean) >= 16 {
			break
		}
	}
	return prefix + "_" + clean
}

// NewUUID 完整 UUID
func NewUUID() string {
	return uuid.New().String()
}

// RandomToken 生成 32 字节随机 token（hex 编码）
func RandomToken() string {
	b := make([]byte, 32)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

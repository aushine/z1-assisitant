package utility

import "golang.org/x/crypto/bcrypt"

// DefaultBcryptCost 默认 bcrypt cost（10-12 之间）
var DefaultBcryptCost = 12

// HashPassword 哈希密码
func HashPassword(plain string) (string, error) {
	bytes, err := bcrypt.GenerateFromPassword([]byte(plain), DefaultBcryptCost)
	if err != nil {
		return "", err
	}
	return string(bytes), nil
}

// VerifyPassword 校验密码
// 返回 true 表示匹配
func VerifyPassword(hashed, plain string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hashed), []byte(plain)) == nil
}

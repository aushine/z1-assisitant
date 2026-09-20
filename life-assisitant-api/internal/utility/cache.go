package utility

import (
	"sync"
	"time"
)

// PwdResetTokenStore 进程内密码重置 token 存储
// v1: 替代 Redis，简单场景够用
// 进程重启 token 失效（不影响业务，5 分钟 TTL 兜底）
type PwdResetTokenStore struct {
	mu     sync.RWMutex
	tokens map[string]pwdResetEntry // token -> {userID, expireAt}
}

type pwdResetEntry struct {
	userID    string
	expireAt  time.Time
}

var pwdResetStore = &PwdResetTokenStore{
	tokens: make(map[string]pwdResetEntry),
}

// PwdResetSet 存 token
func PwdResetSet(token, userID string, ttl time.Duration) {
	pwdResetStore.mu.Lock()
	defer pwdResetStore.mu.Unlock()
	pwdResetStore.tokens[token] = pwdResetEntry{
		userID:   userID,
		expireAt: time.Now().Add(ttl),
	}
}

// PwdResetGet 取 token 对应的 userID
func PwdResetGet(token string) (string, bool) {
	pwdResetStore.mu.RLock()
	entry, ok := pwdResetStore.tokens[token]
	pwdResetStore.mu.RUnlock()
	if !ok {
		return "", false
	}
	if time.Now().After(entry.expireAt) {
		// 过期清理
		pwdResetStore.mu.Lock()
		delete(pwdResetStore.tokens, token)
		pwdResetStore.mu.Unlock()
		return "", false
	}
	return entry.userID, true
}

// PwdResetDel 删 token
func PwdResetDel(token string) {
	pwdResetStore.mu.Lock()
	delete(pwdResetStore.tokens, token)
	pwdResetStore.mu.Unlock()
}

package middleware

import (
	"strconv"
	"sync"
	"time"

	"github.com/gogf/gf/v2/net/ghttp"

	"github.com/life-assistant/api/internal/consts"
	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/response"
)

// RateLimitRule 限流规则
type RateLimitRule struct {
	Scope     string                // "ip" / "user"
	Path      string                // 路径匹配，* 表示全部
	Limit     int                   // 允许次数
	Window    time.Duration         // 时间窗
	Dimension func(r *ghttp.Request) string // 维度计算函数
}

// rateLimitEntry 进程内缓存条目
type rateLimitEntry struct {
	count       int
	windowStart time.Time
}

var (
	rateLimitCache = make(map[string]*rateLimitEntry)
	rateLimitMu    sync.Mutex
)

// RateLimit 限流中间件
// v1: 使用进程内变量缓存（替代 Redis）
// 注意：多实例部署时各进程独立计数，未来高并发场景需改用 Redis
func RateLimit(rules ...RateLimitRule) func(r *ghttp.Request) {
	return func(r *ghttp.Request) {
		ctx := r.Context()
		now := time.Now()
		for _, rule := range rules {
			if rule.Path != "*" && rule.Path != r.URL.Path {
				continue
			}
			dim := rule.Dimension(r)
			key := "rl:" + rule.Scope + ":" + dim + ":" + r.URL.Path

			rateLimitMu.Lock()
			entry, ok := rateLimitCache[key]
			if !ok || now.Sub(entry.windowStart) >= rule.Window {
				// 新窗口或窗口已过
				rateLimitCache[key] = &rateLimitEntry{count: 1, windowStart: now}
				rateLimitMu.Unlock()
				continue
			}
			entry.count++
			count := entry.count
			rateLimitMu.Unlock()

			if count > rule.Limit {
				// 设置响应头
				r.Response.Header().Set("X-RateLimit-Limit", strconv.Itoa(rule.Limit))
				r.Response.Header().Set("X-RateLimit-Remaining", "0")
				r.Response.Header().Set("Retry-After", strconv.Itoa(int(rule.Window.Seconds())))
				response.ErrorWithDetails(r, ecode.RateLimitExceeded, map[string]any{
					"retry_after": int(rule.Window.Seconds()),
				})
				return
			}
		}
		_ = ctx
		r.Middleware.Next()
	}
}

// IP 维度
func IP(r *ghttp.Request) string {
	return r.GetClientIp()
}

// User 维度
func User(r *ghttp.Request) string {
	return r.GetCtxVar("user_id").String()
}

// 常用规则集
var (
	// LoginRateLimit 登录接口：每 IP 每 5 分钟 30 次
	LoginRateLimit = RateLimit(RateLimitRule{
		Scope: "ip", Path: consts.APIPrefix + "/auth/login",
		Limit: 30, Window: 5 * time.Minute, Dimension: IP,
	})
)

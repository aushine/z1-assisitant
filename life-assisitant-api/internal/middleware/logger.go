package middleware

import (
	"time"

	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"
)

// AccessLog 访问日志中间件
// 记录 method/path/status/cost/user_id/request_id
func AccessLog(r *ghttp.Request) {
	start := time.Now()
	r.Middleware.Next()

	cost := time.Since(start).Milliseconds()
	g.Log("access").Infof(r.Context(),
		"%s %s %d %dms rid=%s uid=%s ip=%s",
		r.Method,
		r.URL.Path,
		r.Response.Status,
		cost,
		r.GetCtxVar("request_id").String(),
		r.GetCtxVar("user_id").String(),
		r.GetClientIp(),
	)
}

// Package middleware 存放所有 HTTP 中间件
// 详细规范见 ../life-assisitant/md/spec/30-后端架构.md §7
package middleware

import (
	"github.com/gogf/gf/v2/frame/g"
	"github.com/gogf/gf/v2/net/ghttp"

	"github.com/life-assistant/api/internal/utility"
)

// RequestId 请求 ID 中间件
// 1. 优先取请求头 X-Request-Id
// 2. 否则生成新的 request_id
// 3. 写入 ctx + 响应头
func RequestId(r *ghttp.Request) {
	rid := r.Header.Get("X-Request-Id")
	if rid == "" {
		rid = "req_" + utility.NewUUID()
	}
	r.SetCtxVar("request_id", rid)
	r.Response.Header().Set("X-Request-Id", rid)
	r.Middleware.Next()
}

// CORS 跨域中间件（生产环境应严格限制 Origin）
func CORS(r *ghttp.Request) {
	r.Response.CORSDefault()
	r.Response.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Device-Id, X-Request-Id, X-Client-Version, X-Client-Platform")
	r.Response.Header().Set("Access-Control-Expose-Headers", "X-Request-Id")
	if r.Method == "OPTIONS" {
		r.Response.Status = 204
		return
	}
	r.Middleware.Next()
}

// Recovery panic 恢复
func Recovery(r *ghttp.Request) {
	defer func() {
		if err := recover(); err != nil {
			g.Log("error").Errorf(r.Context(), "panic: %v", err)
			r.Response.Status = 500
			r.Response.WriteJsonExit(map[string]any{
				"code":    500001,
				"error":   "INTERNAL_ERROR",
				"message": "服务器内部错误",
			})
		}
	}()
	r.Middleware.Next()
}

// UTF8 强制 JSON 响应头带 charset=utf-8（避免中文乱码）
func UTF8(r *ghttp.Request) {
	r.Response.Header().Set("Content-Type", "application/json; charset=utf-8")
	r.Middleware.Next()
}

package middleware

import (
	"strings"

	"github.com/gogf/gf/v2/errors/gerror"
	"github.com/gogf/gf/v2/net/ghttp"

	"github.com/life-assistant/api/internal/consts"
	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/response"
	"github.com/life-assistant/api/internal/utility"
)

// JwtAuth JWT 鉴权中间件
// 1. 白名单放行
// 2. 提取 Authorization: Bearer xxx
// 3. 解析 access_token
// 4. 写入 ctx: user_id / role / device_id
func JwtAuth(r *ghttp.Request) {
	// 1. 白名单
	if isWhitelist(r.URL.Path, r.Method) {
		r.Middleware.Next()
		return
	}

	// 2. 取 token
	auth := r.Header.Get("Authorization")
	if !strings.HasPrefix(auth, "Bearer ") {
		response.Error(r, ecode.AuthTokenMissing)
		return
	}
	tokenStr := strings.TrimPrefix(auth, "Bearer ")
	if tokenStr == "" {
		response.Error(r, ecode.AuthTokenMissing)
		return
	}

	// 3. 解析
	claims, err := utility.ParseToken(tokenStr, true)
	if err != nil {
		if strings.Contains(err.Error(), "expired") {
			response.Error(r, ecode.AuthTokenExpired)
			return
		}
		response.Error(r, ecode.AuthTokenInvalid)
		return
	}
	if claims.TokenType != utility.TokenTypeAccess {
		response.Error(r, ecode.AuthTokenInvalid)
		return
	}

	// 4. 注入 ctx
	r.SetCtxVar("user_id", claims.UserID)
	r.SetCtxVar("role", claims.Role)
	r.SetCtxVar("device_id", claims.DeviceID)
	r.SetCtxVar("token", tokenStr)

	r.Middleware.Next()
}

// 白名单（不需要鉴权）
func isWhitelist(path, method string) bool {
	// OPTIONS 预检
	if method == "OPTIONS" {
		return true
	}
	// /z1/uploads/ 静态资源（头像等）公开直出：<img src> 不会携带 Authorization 头，
	// 若被鉴权拦下只会拿到 JSON 错误体、图片恒加载失败（回落首字）。
	// 该前缀下只有用户上传的公开图片，不含敏感数据，放行安全。
	// 旧 /uploads/ 前缀（第十三轮前产物）一并放行——路由已无此前缀，仅兼容历史 URL。
	if strings.HasPrefix(path, consts.UploadsPrefix+"/") ||
		strings.HasPrefix(path, consts.LegacyUploadsPrefix+"/") {
		return true
	}
	whitelist := map[string][]string{
		consts.APIPrefix + "/auth/login":           {"POST"},
		consts.APIPrefix + "/auth/register":        {"POST"},
		consts.APIPrefix + "/auth/refresh":         {"POST"},
		consts.APIPrefix + "/auth/forgot-password": {"POST"},
		consts.APIPrefix + "/auth/reset-password":  {"POST"},
		consts.APIPrefix + "/health":               {"GET"},
		consts.APIPrefix + "/app/uploads-base":     {"GET"},
		"/api.json":                                {"GET"},
		"/swagger":                                 {"GET"},
	}
	if methods, ok := whitelist[path]; ok {
		for _, m := range methods {
			if m == method {
				return true
			}
		}
	}
	return false
}

// guard 辅助：保证后续中间件能拿到 user_id
func guard(r *ghttp.Request) {
	if r.GetCtxVar("user_id").String() == "" {
		_ = gerror.New("user_id not in context")
	}
}

package middleware

import (
	"context"

	"github.com/gogf/gf/v2/net/ghttp"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/model"
	"github.com/life-assistant/api/internal/response"
	"github.com/life-assistant/api/internal/service"
)

// RequireRole 角色守卫：当前用户的 role 必须在允许列表中
// 用法：router.Group(...).Middleware(middleware.RequireRole(model.RoleAdmin))
func RequireRole(roles ...string) func(r *ghttp.Request) {
	return func(r *ghttp.Request) {
		role := r.GetCtxVar("role").String()
		for _, allowed := range roles {
			if role == allowed {
				r.Middleware.Next()
				return
			}
		}
		response.Error(r, ecode.RoleInsufficient)
	}
}

// RequireAdmin 管理员守卫（最常用）
func RequireAdmin(r *ghttp.Request) {
	role := r.GetCtxVar("role").String()
	if role != model.RoleAdmin {
		response.Error(r, ecode.AdminRequired)
		return
	}
	r.Middleware.Next()
}

// RequirePermission 细粒度权限点守卫（D-03 权限重构）
// points 形如 "user_mgmt:view"，语义为「任一命中即放行」(ANY-of)。
//   - admin 直通：管理员矩阵固定为全权限，无需查库；
//   - 其余角色：查其角色矩阵，命中任一 point 放行，否则 PermissionDenied(403001)。
//
// 用法（务必走子分组，见 D-01 教训——GF 的 GET 第三参不是中间件）：
//
//	group.Group("", func(g *ghttp.RouterGroup) {
//	    g.Middleware(middleware.RequirePermission("user_mgmt:view"))
//	    g.GET("/users", User.List)
//	})
//
// 同一路由由多个操作共享时（如 POST /tasks/batch 覆盖 complete/delete），
// 传多个 point 做 ANY 粗筛，再由 controller 用 PermissionGranted 按实际 action 细分。
func RequirePermission(points ...string) func(r *ghttp.Request) {
	return func(r *ghttp.Request) {
		role := r.GetCtxVar("role").String()
		if role == model.RoleAdmin {
			r.Middleware.Next()
			return
		}
		ok, err := service.Permission().RoleHas(r.Context(), role, points...)
		if err != nil {
			response.Error(r, ecode.InternalError, err)
			return
		}
		if !ok {
			response.Error(r, ecode.PermissionDenied)
			return
		}
		r.Middleware.Next()
	}
}

// PermissionGranted 供 controller 内部做单点细判（如批量操作按 action 分权）。
// admin 恒为 true；其余角色查矩阵。role 从 JWT 注入的 ctx 变量读取。
func PermissionGranted(ctx context.Context, role, point string) bool {
	if role == model.RoleAdmin {
		return true
	}
	ok, err := service.Permission().RoleHas(ctx, role, point)
	return err == nil && ok
}

package controller

import (
	"github.com/gogf/gf/v2/net/ghttp"

	"github.com/life-assistant/api/internal/response"
	"github.com/life-assistant/api/internal/service"
)

// PermissionController 权限
type PermissionController struct{}

var Permission = &PermissionController{}

// List GET /api/v1/permissions
func (c *PermissionController) List(r *ghttp.Request) {
	ps, err := service.Permission().ListPermissions(r.Context())
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, ps)
}

// GetUserPermissions GET /api/v1/users/:id/permissions
func (c *PermissionController) GetUserPermissions(r *ghttp.Request) {
	id := r.Get("id").String()
	out, err := service.Permission().GetUserPermissions(r.Context(), id)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// MyPermissions GET /api/v1/auth/me/permissions
func (c *PermissionController) MyPermissions(r *ghttp.Request) {
	uid := r.GetCtxVar("user_id").String()
	out, err := service.Permission().GetUserPermissions(r.Context(), uid)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

package controller

import (
	"github.com/gogf/gf/v2/net/ghttp"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/response"
	"github.com/life-assistant/api/internal/service"
)

// RoleController 角色
type RoleController struct{}

var Role = &RoleController{}

// List GET /api/v1/roles
func (c *RoleController) List(r *ghttp.Request) {
	roles, err := service.Role().ListRoles(r.Context())
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, roles)
}

// Get GET /api/v1/roles/:code
func (c *RoleController) Get(r *ghttp.Request) {
	code := r.Get("code").String()
	role, err := service.Role().GetRole(r.Context(), code)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, role)
}

// AssignRole PUT /api/v1/users/:id/role
// D-03：角色编码不再硬编码枚举（editor/viewer 已废弃、自定义角色动态），存在性由 service 查库
func (c *RoleController) AssignRole(r *ghttp.Request) {
	uid := r.Get("id").String()
	var req struct {
		Role string `json:"role" v:"required|length:2,20"`
	}
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	if err := service.Role().AssignRole(r.Context(), uid, req.Role); err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, map[string]any{"message": "角色已分配"})
}

// Create POST /api/v1/roles 新建自定义角色
func (c *RoleController) Create(r *ghttp.Request) {
	var req dto.CreateRoleReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	role, err := service.Role().CreateRole(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Created(r, role)
}

// Update PATCH /api/v1/roles/:code 更新角色元信息（名称/描述）
func (c *RoleController) Update(r *ghttp.Request) {
	code := r.Get("code").String()
	var req dto.UpdateRoleReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	role, err := service.Role().UpdateRole(r.Context(), code, &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, role)
}

// Delete DELETE /api/v1/roles/:code 删除自定义角色
func (c *RoleController) Delete(r *ghttp.Request) {
	code := r.Get("code").String()
	if err := service.Role().DeleteRole(r.Context(), code); err != nil {
		writeError(r, err)
		return
	}
	response.NoContent(r)
}

// GetRoleMatrix GET /api/v1/roles/:code/permissions
func (c *RoleController) GetRoleMatrix(r *ghttp.Request) {
	code := r.Get("code").String()
	matrix, err := service.Permission().GetRoleMatrix(r.Context(), code)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, matrix)
}

// UpdateRoleMatrix PUT /api/v1/roles/:code/permissions
func (c *RoleController) UpdateRoleMatrix(r *ghttp.Request) {
	code := r.Get("code").String()
	var req dto.UpdatePermissionMatrixReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	if err := service.Permission().UpdateRoleMatrix(r.Context(), code, &req); err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, map[string]any{"message": "权限已生效"})
}

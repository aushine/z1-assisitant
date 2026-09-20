package service

import (
	"context"

	"github.com/life-assistant/api/internal/model"
	"github.com/life-assistant/api/internal/model/dto"
)

// IUserService 用户服务
type IUserService interface {
	// GetMe 获取当前登录用户信息
	GetMe(ctx context.Context, userID string) (*dto.UserResp, error)
	// GetUser 获取指定用户（仅管理员）
	GetUser(ctx context.Context, id string) (*dto.UserResp, error)
	// ListUsers 用户列表（分页 + 筛选，仅管理员）
	ListUsers(ctx context.Context, req *dto.ListUsersReq) ([]dto.UserResp, int64, error)
	// CreateUser 创建用户（管理员代建）
	CreateUser(ctx context.Context, operatorID string, req *dto.CreateUserReq) (*dto.UserResp, string, error)
	// UpdateUser 更新用户
	UpdateUser(ctx context.Context, operatorID, id string, req *dto.UpdateUserReq) (*dto.UserResp, error)
	// UpdateMe 当前用户自助更新个人资料（仅 name/email/phone/avatar）
	UpdateMe(ctx context.Context, userID string, req *dto.UpdateMeReq) (*dto.UserResp, error)
	// SetAvatarURL 更新头像 URL 并返回旧 URL（D-03 第八轮：文件已落盘，这里只写库；
	// 调用方据旧 URL 用 utility.AvatarURLToPath 清理受管文件）
	SetAvatarURL(ctx context.Context, userID, url string) (oldURL string, err error)
	// UpdateStatus 启用/禁用
	UpdateStatus(ctx context.Context, operatorID, id string, req *dto.UpdateUserStatusReq) error
	// DeleteUser 删除（软删）
	DeleteUser(ctx context.Context, operatorID, id string) error
}

// IRoleService 角色服务
// D-03 权限重构：内置角色只剩 admin/user，自定义角色可增删改
type IRoleService interface {
	ListRoles(ctx context.Context) ([]dto.RoleResp, error)
	GetRole(ctx context.Context, code string) (*dto.RoleResp, error)
	AssignRole(ctx context.Context, userID, roleCode string) error
	// CreateRole 新建自定义角色（is_system=false，初始矩阵为空）
	CreateRole(ctx context.Context, req *dto.CreateRoleReq) (*dto.RoleResp, error)
	// UpdateRole 更新角色元信息（name/description）；code 不可变
	UpdateRole(ctx context.Context, code string, req *dto.UpdateRoleReq) (*dto.RoleResp, error)
	// DeleteRole 删除自定义角色（内置角色拒删；仍有用户占用拒删；连带清矩阵）
	DeleteRole(ctx context.Context, code string) error
}

// IPermissionService 权限服务
type IPermissionService interface {
	ListPermissions(ctx context.Context) ([]dto.PermissionResp, error)
	// GetRoleMatrix 获取某角色权限矩阵
	GetRoleMatrix(ctx context.Context, roleCode string) (*dto.PermissionMatrixResp, error)
	// UpdateRoleMatrix 更新角色权限矩阵（带乐观锁，仅 admin）
	UpdateRoleMatrix(ctx context.Context, roleCode string, req *dto.UpdatePermissionMatrixReq) error
	// GetUserPermissions 获取某用户的有效权限
	GetUserPermissions(ctx context.Context, userID string) (*dto.UserPermissionsResp, error)
	// RoleHas 角色是否拥有任一给定权限点（"module:action"）；admin 恒 true
	RoleHas(ctx context.Context, roleCode string, points ...string) (bool, error)
	// 工具：把 model 转换到 DTO（不导出，但其他 service 可用）
	RoleToDTO(r *model.Role) dto.RoleResp
	PermissionToDTO(p *model.Permission) dto.PermissionResp
	UserToDTO(u *model.User) dto.UserResp
}

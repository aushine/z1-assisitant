package dto

// ====== 用户管理 ======

// CreateUserReq 新建用户（管理员代建）
// D-03 第六轮：不再填 email/department/密码——统一初始密码（service 常量），
// 首登强制提示改密（pwd_reset_required）；email 留空落 NULL。
type CreateUserReq struct {
	Username   string `json:"username"   v:"required|length:4,32|regex:^[a-zA-Z0-9_]+$"`
	Name       string `json:"name"       v:"required|length:2,20"`
	Email      string `json:"email"      v:"email"`
	Phone      string `json:"phone"      v:"length:0,20"`
	Role       string `json:"role"       v:"required|length:2,20" dc:"角色编码；D-03 起不再硬编码枚举，存在性由 service 查 roles 表校验"`
	Department string `json:"department" v:"length:0,50"`
}

// UpdateUserReq 更新用户（部分字段）
type UpdateUserReq struct {
	Name       *string `json:"name"       v:"length:2,20"`
	Email      *string `json:"email"      v:"email"`
	Phone      *string `json:"phone"      v:"length:0,20"`
	Avatar     *string `json:"avatar"` // 第八轮起为 /uploads/ 受管路径或 http(s) 外链（data: 已废弃），service 层 validAvatar 校验
	Role       *string `json:"role"       v:"length:2,20" dc:"角色编码；存在性由 service 查库校验"`
	Department *string `json:"department" v:"length:0,50"`
	Version    int     `json:"version"    v:"required|min:0" dc:"乐观锁版本号"`
}

// UpdateUserStatusReq 启用/禁用用户
type UpdateUserStatusReq struct {
	Status  string `json:"status"  v:"required|in:active,disabled"`
	Version int    `json:"version" v:"required|min:0"`
}

// UpdateMeReq 当前用户自助更新个人资料
// 仅允许 name / email / phone / avatar（role / status / department 不在字段中，天然阻断提权）
type UpdateMeReq struct {
	Name    *string `json:"name"    v:"length:2,20"`
	Email   *string `json:"email"   v:"email"`
	Phone   *string `json:"phone"   v:"length:0,20"`
	Avatar  *string `json:"avatar"` // 同上：/uploads/ 或 http(s)，data: 已废弃
	Version *int    `json:"version" dc:"乐观锁版本号（可选，缺省时用服务端当前版本）"`
}

// ListUsersReq 用户列表查询
type ListUsersReq struct {
	Keyword  string `json:"keyword"   v:"length:0,50" dc:"按姓名/邮箱/手机号/用户名搜索"`
	Role     string `json:"role"      dc:"角色编码筛选；D-03 起接受任意已存在编码"`
	Status   string `json:"status"    v:"in:,active,disabled,deleted"`
	Page     int    `json:"page"      v:"min:1"  d:"1"`
	PageSize int    `json:"page_size" v:"max:100" d:"20"`
}

// UserResp 用户对象（API 响应）
type UserResp struct {
	ID             string `json:"id"`
	Username       string `json:"username"`
	Name           string `json:"name"`
	Email          string `json:"email"`
	Phone          string `json:"phone,omitempty"`
	Avatar         string `json:"avatar,omitempty"`
	Role           string `json:"role"`
	Department     string `json:"department,omitempty"`
	Status         string `json:"status"`
	CreatedAt      string `json:"created_at"`
	UpdatedAt      string `json:"updated_at"`
	LastLoginAt    string `json:"last_login_at,omitempty"`
	LastLoginIP    string `json:"last_login_ip,omitempty"`
	LastLoginDevice string `json:"last_login_device,omitempty"`
	Version        int    `json:"version"`
	// PwdResetRequired 代建用户初始密码未改（/auth/me 同带，刷新后提示不丢）
	PwdResetRequired bool `json:"pwd_reset_required"`
}

// ====== 角色 ======

// RoleResp 角色对象
type RoleResp struct {
	ID          int64  `json:"id"` // 自增排序号：admin=1，user=2，自定义按创建顺序递增
	Code        string `json:"code"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	IsSystem    bool   `json:"is_system"`
	UserCount   int    `json:"user_count"`
}

// ====== 权限 ======

// PermissionResp 权限点
type PermissionResp struct {
	ID          string `json:"id"`
	Module      string `json:"module"`
	Action      string `json:"action"`
	Description string `json:"description,omitempty"`
}

// PermissionMatrixResp 角色权限矩阵
type PermissionMatrixResp struct {
	Role      string              `json:"role"`
	Version   int                 `json:"version"`
	UpdatedAt string              `json:"updated_at"`
	Matrix    map[string][]string `json:"matrix"` // module -> actions
}

// UpdatePermissionMatrixReq 更新角色权限矩阵
// Version 不再 required：新建自定义角色的矩阵为空、版本恒 0，
// 首次保存必须能以 version=0 通过（GF 对零值字段跳过 min 校验，负数仍会被拦）。
type UpdatePermissionMatrixReq struct {
	Version int                 `json:"version" v:"min:0"`
	Matrix  map[string][]string `json:"matrix"  v:"required"` // module -> actions
}

// ====== 角色 CRUD（D-03 权限重构：自定义角色可新增/编辑/删除） ======

// CreateRoleReq 新建自定义角色（初始矩阵为空，创建后在权限页勾选保存）
type CreateRoleReq struct {
	Code        string `json:"code"        v:"required|regex:^[a-z][a-z0-9_]{1,19}$#角色标识需以小写字母开头，仅含小写字母/数字/下划线，2-20 位"`
	Name        string `json:"name"        v:"required|length:2,20"`
	Description string `json:"description" v:"length:0,200"`
}

// UpdateRoleReq 更新角色元信息（编码不可变；矩阵改动走 PUT /roles/:code/permissions）
type UpdateRoleReq struct {
	Name        *string `json:"name"        v:"length:2,20"`
	Description *string `json:"description" v:"length:0,200"`
}

// UserPermissionsResp 用户的有效权限
type UserPermissionsResp struct {
	UserID      string              `json:"user_id"`
	Role        string              `json:"role"`
	Permissions []string            `json:"permissions"`             // ["home:view", "tasks:read", ...]
	Matrix      map[string][]string `json:"matrix"`
}

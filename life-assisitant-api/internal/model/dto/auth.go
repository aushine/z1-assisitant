// Package dto 定义 API 请求 / 响应 DTO
// 字段命名遵循 snake_case（与 JSON 风格一致）
package dto

// ====== 登录 ======

// LoginReq 登录请求
type LoginReq struct {
	Username string `json:"username" v:"required|length:4,100" dc:"账号/邮箱"` // 支持用户名或邮箱
	Password string `json:"password" v:"required|length:6,32"  dc:"明文密码"`
	Remember bool   `json:"remember" dc:"是否记住密码（7天免登录，仅当前设备）"`
	DeviceID string `json:"device_id" v:"required" dc:"设备指纹 UUID"`
}

// LoginResp 登录响应
type LoginResp struct {
	AccessToken  string   `json:"access_token"  dc:"访问 token（15分钟有效）"`
	RefreshToken string   `json:"refresh_token" dc:"刷新 token（7天有效）"`
	ExpiresIn    int      `json:"expires_in"    dc:"access_token 过期秒数"`
	TokenType    string   `json:"token_type"    dc:"固定 Bearer"`
	User         UserInfo `json:"user"          dc:"当前用户信息"`
}

// UserInfo 用户信息（用于登录响应 / 当前用户）
type UserInfo struct {
	ID         string `json:"id"`
	Username   string `json:"username"`
	Name       string `json:"name"`
	Email      string `json:"email"`
	Phone      string `json:"phone,omitempty"`
	Avatar     string `json:"avatar,omitempty"`
	Role       string `json:"role"`
	Department string `json:"department,omitempty"`
	Status     string `json:"status"`
	Version    int    `json:"version"`
	// PwdResetRequired 管理员代建的初始密码尚未修改 → 前端主界面提示去安全页改密
	PwdResetRequired bool `json:"pwd_reset_required"`
}

// ====== 注册 ======

// RegisterReq 注册请求
// D-03 权限重构：删除 Role 字段——注册自选角色是提权漏洞（可自行注册 admin）；
// 且前端 RegisterReq 类型从未包含 role，旧 `v:"required"` 会让 UI 注册必挂。
// 注册用户一律落到内置 user 角色，改角色只能由管理员在用户管理里操作。
type RegisterReq struct {
	Username string `json:"username" v:"required|length:4,32|regex:^[a-zA-Z0-9_]+$"`
	Password string `json:"password" v:"required|length:8,32"`
	Name     string `json:"name"     v:"required|length:2,20"`
	Email    string `json:"email"    v:"required|email"`
	Phone    string `json:"phone"    v:"length:11,11"`
	DeviceID string `json:"device_id" v:"required"`
}

// RegisterResp 注册响应
type RegisterResp struct {
	AccessToken  string   `json:"access_token"`
	RefreshToken string   `json:"refresh_token"`
	ExpiresIn    int      `json:"expires_in"`
	User         UserInfo `json:"user"`
}

// ====== Refresh ======

// RefreshReq 刷新 token
type RefreshReq struct {
	RefreshToken string `json:"refresh_token" v:"required"`
	DeviceID     string `json:"device_id"     v:"required"`
}

// RefreshResp 刷新响应（rotation：新 access + 新 refresh）
type RefreshResp struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
}

// ====== Logout ======

// LogoutReq 退出登录
type LogoutReq struct {
	RefreshToken string `json:"refresh_token" dc:"可选，若带则同时撤销该 refresh_token"`
	AllDevices   bool   `json:"all_devices"   dc:"是否同时退出所有设备"`
}

// ====== 登录设备（会话）======

// SessionResp 一条活跃登录会话（数据源 refresh_tokens）
// 只暴露非敏感字段——token_hash 绝不出网关；device_id 前端用于标记「当前设备」。
type SessionResp struct {
	ID        string `json:"id"`
	DeviceID  string `json:"device_id"`
	Platform  string `json:"platform"   dc:"desktop / mobile，由 device_id 前缀推断"`
	IP        string `json:"ip,omitempty"`
	LoginAt   string `json:"login_at"   dc:"会话建立时间 RFC3339"`
	ExpiresAt string `json:"expires_at" dc:"refresh_token 过期时间 RFC3339"`
}

// ====== 改密 / 忘记密码 ======

// ChangePasswordReq 修改密码
type ChangePasswordReq struct {
	OldPassword string `json:"old_password" v:"required|length:6,32"`
	NewPassword string `json:"new_password" v:"required|length:8,32"`
}

// ForgotPasswordReq 忘记密码
type ForgotPasswordReq struct {
	Email string `json:"email" v:"required|email"`
}

// ResetPasswordReq 重置密码（凭 token）
type ResetPasswordReq struct {
	Token       string `json:"token"        v:"required"`
	NewPassword string `json:"new_password" v:"required|length:8,32"`
}

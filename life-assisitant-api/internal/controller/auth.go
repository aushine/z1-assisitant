// Package controller HTTP 控制器
// 规范：controller 只做参数解析 + 调 service + 返回响应
// 业务校验在 service 层完成
package controller

import (
	"github.com/gogf/gf/v2/net/ghttp"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/response"
	"github.com/life-assistant/api/internal/service"
)

// AuthController 认证控制器
type AuthController struct{}

var Auth = &AuthController{}

// Login POST /api/v1/auth/login
func (c *AuthController) Login(r *ghttp.Request) {
	var req dto.LoginReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Auth().Login(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// Register POST /api/v1/auth/register
func (c *AuthController) Register(r *ghttp.Request) {
	var req dto.RegisterReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Auth().Register(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Created(r, out)
}

// RefreshToken POST /api/v1/auth/refresh
func (c *AuthController) RefreshToken(r *ghttp.Request) {
	var req dto.RefreshReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	out, err := service.Auth().RefreshToken(r.Context(), &req)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, out)
}

// Logout POST /api/v1/auth/logout
func (c *AuthController) Logout(r *ghttp.Request) {
	uid := r.GetCtxVar("user_id").String()
	if uid == "" {
		response.Error(r, ecode.AuthTokenMissing)
		return
	}
	var req dto.LogoutReq
	_ = r.Parse(&req)
	if err := service.Auth().Logout(r.Context(), uid, req.RefreshToken, req.AllDevices); err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, map[string]any{"message": "已退出登录"})
}

// ChangePassword POST /api/v1/auth/change-password
func (c *AuthController) ChangePassword(r *ghttp.Request) {
	uid := r.GetCtxVar("user_id").String()
	if uid == "" {
		response.Error(r, ecode.AuthTokenMissing)
		return
	}
	var req dto.ChangePasswordReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	if req.OldPassword == req.NewPassword {
		response.Error(r, ecode.PasswordSameAsOld)
		return
	}
	if err := service.Auth().ChangePassword(r.Context(), uid, req.OldPassword, req.NewPassword); err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, map[string]any{"message": "密码已修改，请重新登录"})
}

// ForgotPassword POST /api/v1/auth/forgot-password
func (c *AuthController) ForgotPassword(r *ghttp.Request) {
	var req dto.ForgotPasswordReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	if err := service.Auth().ForgotPassword(r.Context(), req.Email); err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, map[string]any{"message": "若该邮箱已注册，重置链接已发送"})
}

// ResetPassword POST /api/v1/auth/reset-password
func (c *AuthController) ResetPassword(r *ghttp.Request) {
	var req dto.ResetPasswordReq
	if err := r.Parse(&req); err != nil {
		response.Error(r, ecode.ValidationFailed, err)
		return
	}
	if err := service.Auth().ResetPassword(r.Context(), req.Token, req.NewPassword); err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, map[string]any{"message": "密码已重置"})
}

// Me GET /api/v1/auth/me
func (c *AuthController) Me(r *ghttp.Request) {
	uid := r.GetCtxVar("user_id").String()
	if uid == "" {
		response.Error(r, ecode.AuthTokenMissing)
		return
	}
	u, err := service.User().GetMe(r.Context(), uid)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, u)
}

// Sessions GET /api/v1/auth/sessions
// 当前账号的活跃登录会话（前端「登录设备」）。属会话生命周期路由，不挂权限点——
// 任何已登录用户都该能看见并管理自己的登录设备。
func (c *AuthController) Sessions(r *ghttp.Request) {
	uid := r.GetCtxVar("user_id").String()
	if uid == "" {
		response.Error(r, ecode.AuthTokenMissing)
		return
	}
	list, err := service.Auth().ListSessions(r.Context(), uid)
	if err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, map[string]any{"items": list})
}

// RevokeSession DELETE /api/v1/auth/sessions/:id
// 退出指定的某一台设备（归属校验在 service/dao 层，前端传的 id 不可信）。
func (c *AuthController) RevokeSession(r *ghttp.Request) {
	uid := r.GetCtxVar("user_id").String()
	if uid == "" {
		response.Error(r, ecode.AuthTokenMissing)
		return
	}
	if err := service.Auth().RevokeSession(r.Context(), uid, r.Get("id").String()); err != nil {
		writeError(r, err)
		return
	}
	response.Success(r, map[string]any{"message": "该设备已退出"})
}

// ====== 工具函数 ======

// writeError 把 service 层抛出的 gerror（带 BusinessCode）转换为统一响应
// 2026-09-17 勘误：原实现命中 BusinessCode 分支时不打日志、不外显底层错误，
// 导致「数据库错误」既不进控制台也不进响应体，排障全靠猜。
// 现在真实错误一律随响应带出（details.cause）；日志在 response.Error 内统一落，此处不再重复打印。
func writeError(r *ghttp.Request, err error) {
	if code := gerrorCodeOf(err); code != nil {
		response.Error(r, *code, err)
		return
	}
	response.Error(r, ecode.InternalError, err)
}

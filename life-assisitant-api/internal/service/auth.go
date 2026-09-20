package service

import (
	"context"

	"github.com/life-assistant/api/internal/model/dto"
)

// IAuthService 认证服务
type IAuthService interface {
	// Login 登录
	Login(ctx context.Context, req *dto.LoginReq) (*dto.LoginResp, error)
	// Register 注册
	Register(ctx context.Context, req *dto.RegisterReq) (*dto.RegisterResp, error)
	// RefreshToken 刷新（rotation：旧 refresh 作废，签发新一对）
	RefreshToken(ctx context.Context, req *dto.RefreshReq) (*dto.RefreshResp, error)
	// Logout 退出登录
	Logout(ctx context.Context, userID, refreshToken string, allDevices bool) error
	// ListSessions 当前用户全部活跃登录会话（登录设备列表用）
	ListSessions(ctx context.Context, userID string) ([]dto.SessionResp, error)
	// RevokeSession 撤销当前用户的指定会话（内部校验归属：不能撤销别人的会话）
	RevokeSession(ctx context.Context, userID, sessionID string) error
	// ChangePassword 修改密码（已登录用户）
	ChangePassword(ctx context.Context, userID, oldPwd, newPwd string) error
	// ForgotPassword 申请重置密码（生成 token，存 Redis，5 分钟有效）
	ForgotPassword(ctx context.Context, email string) error
	// ResetPassword 凭 token 重置密码
	ResetPassword(ctx context.Context, token, newPwd string) error
}

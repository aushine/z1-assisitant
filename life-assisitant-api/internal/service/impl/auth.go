// Package impl service 层的实现
package impl

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/gogf/gf/v2/errors/gerror"
	"github.com/gogf/gf/v2/frame/g"
	"gorm.io/gorm"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/dao"
	"github.com/life-assistant/api/internal/model"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/service"
	"github.com/life-assistant/api/internal/utility"
)

// AuthService 认证服务实现
type AuthService struct {
	db *gorm.DB
}

func NewAuthService() service.IAuthService {
	return &AuthService{db: dao.DB}
}

// Register 注册到 service 包（避免循环引用）
func init() {
	service.SetAuth(NewAuthService())
}

// Login 登录
// 1. 查找用户
// 2. 校验账号状态（disabled/deleted/locked）
// 3. 校验密码
// 4. 失败计数（达到阈值锁定）
// 5. 签发 access + refresh
// 6. 存 refresh token
// 7. 更新最后登录信息
func (s *AuthService) Login(ctx context.Context, req *dto.LoginReq) (*dto.LoginResp, error) {
	// 1. 查找
	user, err := dao.User.FindByUsernameOrEmail(ctx, req.Username)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gerror.NewCode(ecode.AuthInvalidCredentials)
		}
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询用户失败")
	}

	// 2. 状态
	if user.Status == model.UserStatusDisabled {
		return nil, gerror.NewCode(ecode.AuthUserDisabled)
	}
	if user.Status == model.UserStatusDeleted {
		return nil, gerror.NewCode(ecode.AuthUserDeleted)
	}
	if user.LockedUntil != nil && user.LockedUntil.After(time.Now()) {
		return nil, gerror.NewCode(ecode.AuthAccountLocked)
	}

	// 3. 密码
	if !utility.VerifyPassword(user.PasswordHash, req.Password) {
		// 累加失败次数
		_ = s.incrementFailedLogin(ctx, user)
		return nil, gerror.NewCode(ecode.AuthInvalidCredentials)
	}

	// 4. 签发 token
	accessToken, ttl, err := utility.GenerateAccessToken(user.ID, user.RoleCode, req.DeviceID)
	if err != nil {
		return nil, gerror.WrapCode(ecode.InternalError, err, "签发 access_token 失败")
	}
	refreshToken, refreshExpires, err := utility.GenerateRefreshToken(user.ID, req.DeviceID)
	if err != nil {
		return nil, gerror.WrapCode(ecode.InternalError, err, "签发 refresh_token 失败")
	}

	// 5. 存 refresh token
	rt := &model.RefreshToken{
		ID:        utility.NewUUID(),
		UserID:    user.ID,
		TokenHash: utility.HashToken(refreshToken),
		DeviceID:  req.DeviceID,
		IP:        strPtr(g.RequestFromCtx(ctx).GetClientIp()),
		ExpiresAt: refreshExpires,
	}
	if err := dao.RefreshToken.Create(ctx, rt); err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "保存 refresh_token 失败")
	}

	// 6. 更新最后登录 + 清零失败计数
	now := time.Now()
	_ = dao.User.Update(ctx, user.ID, map[string]any{
		"last_login_at":     now,
		"last_login_ip":     g.RequestFromCtx(ctx).GetClientIp(),
		"last_login_device": guessDevice(req.DeviceID),
		"failed_login_count": 0,
		"locked_until":      nil,
	})

	// 7. 组装响应
	return &dto.LoginResp{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    ttl,
		TokenType:    "Bearer",
		User: dto.UserInfo{
			ID:         user.ID,
			Username:   user.Username,
			Name:       user.Name,
			Email:      user.Email,
			Phone:      derefStr(user.Phone),
			Avatar:     derefStr(user.Avatar),
			Role:       user.RoleCode,
			Department: derefStr(user.Department),
			Status:     user.Status,
			PwdResetRequired: user.PwdResetRequired, // 登录页据此提示「首登请改密」（D-03 第六轮）
			Version:    user.Version,
		},
	}, nil
}

// Register 注册
func (s *AuthService) Register(ctx context.Context, req *dto.RegisterReq) (*dto.RegisterResp, error) {
	// 检查用户名/邮箱重复
	if existing, _ := dao.User.FindByUsernameOrEmail(ctx, req.Username); existing != nil {
		return nil, gerror.NewCode(ecode.UserUsernameExists)
	}
	if existing, _ := dao.User.FindByUsernameOrEmail(ctx, req.Email); existing != nil {
		return nil, gerror.NewCode(ecode.UserEmailExists)
	}

	// D-03 权限重构：注册不再接受自选角色（原为提权漏洞），恒落内置 user 角色

	// 哈希密码
	hash, err := utility.HashPassword(req.Password)
	if err != nil {
		return nil, gerror.WrapCode(ecode.InternalError, err, "密码哈希失败")
	}

	user := &model.User{
		ID:           utility.NewID("u"),
		Username:     req.Username,
		PasswordHash: hash,
		Name:         req.Name,
		Email:        req.Email,
		Phone:        strPtrOrNil(req.Phone),
		RoleCode:     model.RoleUser, // D-03：注册恒落内置 user 角色（防自选角色提权）
		Status:       model.UserStatusActive,
		Preferences:  model.JSON{"theme": "light", "language": "zh-CN"},
	}
	if err := dao.User.Create(ctx, user); err != nil {
		// 唯一索引冲突兜底
		if strings.Contains(err.Error(), "Duplicate") || strings.Contains(err.Error(), "1062") {
			return nil, gerror.NewCode(ecode.DuplicateResource)
		}
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "创建用户失败")
	}

	// 角色 user_count +1
	_ = dao.Role.IncUserCount(ctx, model.RoleUser, 1)

	// 直接签发 token 让用户登录
	accessToken, ttl, _ := utility.GenerateAccessToken(user.ID, user.RoleCode, req.DeviceID)
	refreshToken, refreshExpires, _ := utility.GenerateRefreshToken(user.ID, req.DeviceID)
	_ = dao.RefreshToken.Create(ctx, &model.RefreshToken{
		ID:        utility.NewUUID(),
		UserID:    user.ID,
		TokenHash: utility.HashToken(refreshToken),
		DeviceID:  req.DeviceID,
		ExpiresAt: refreshExpires,
	})

	return &dto.RegisterResp{
		AccessToken:  accessToken,
		RefreshToken: refreshToken,
		ExpiresIn:    ttl,
		User: dto.UserInfo{
			ID: user.ID, Username: user.Username, Name: user.Name, Email: user.Email,
			Phone: req.Phone, Role: user.RoleCode, Status: user.Status, Version: user.Version,
			PwdResetRequired: user.PwdResetRequired, // 自助注册自设密码，恒为 false
		},
	}, nil
}

// RefreshToken 刷新（rotation：旧 refresh 撤销，签发新一对）
func (s *AuthService) RefreshToken(ctx context.Context, req *dto.RefreshReq) (*dto.RefreshResp, error) {
	claims, err := utility.ParseToken(req.RefreshToken, false)
	if err != nil {
		if strings.Contains(err.Error(), "expired") {
			return nil, gerror.NewCode(ecode.AuthRefreshTokenExpired)
		}
		return nil, gerror.NewCode(ecode.AuthTokenInvalid)
	}
	if claims.TokenType != utility.TokenTypeRefresh {
		return nil, gerror.NewCode(ecode.AuthTokenInvalid)
	}
	if claims.DeviceID != req.DeviceID {
		return nil, gerror.NewCode(ecode.AuthDeviceMismatch)
	}

	// DB 校验：hash 是否存在 + 未撤销
	hash := utility.HashToken(req.RefreshToken)
	rt, err := dao.RefreshToken.FindByHash(ctx, hash)
	if err != nil {
		return nil, gerror.NewCode(ecode.AuthRefreshTokenRevoked)
	}
	if rt.RevokedAt != nil {
		return nil, gerror.NewCode(ecode.AuthRefreshTokenRevoked)
	}
	if rt.ExpiresAt.Before(time.Now()) {
		return nil, gerror.NewCode(ecode.AuthRefreshTokenExpired)
	}

	// 重新查 user（确保未禁用）
	user, err := dao.User.FindByID(ctx, claims.UserID)
	if err != nil {
		return nil, gerror.NewCode(ecode.AuthUserDisabled)
	}
	if user.Status != model.UserStatusActive {
		return nil, gerror.NewCode(ecode.AuthUserDisabled)
	}

	// 撤销旧 refresh，签发新一对
	_ = dao.RefreshToken.RevokeByID(ctx, rt.ID)

	newAccess, ttl, _ := utility.GenerateAccessToken(user.ID, user.RoleCode, req.DeviceID)
	newRefresh, refreshExpires, _ := utility.GenerateRefreshToken(user.ID, req.DeviceID)
	_ = dao.RefreshToken.Create(ctx, &model.RefreshToken{
		ID:        utility.NewUUID(),
		UserID:    user.ID,
		TokenHash: utility.HashToken(newRefresh),
		DeviceID:  req.DeviceID,
		ExpiresAt: refreshExpires,
	})

	return &dto.RefreshResp{
		AccessToken:  newAccess,
		RefreshToken: newRefresh,
		ExpiresIn:    ttl,
	}, nil
}

// Logout 退出
// allDevices=true 时撤销该用户所有未过期的 refresh token
func (s *AuthService) Logout(ctx context.Context, userID, refreshToken string, allDevices bool) error {
	if allDevices {
		return dao.RefreshToken.RevokeByUser(ctx, userID)
	}
	if refreshToken == "" {
		return nil
	}
	hash := utility.HashToken(refreshToken)
	rt, err := dao.RefreshToken.FindByHash(ctx, hash)
	if err != nil {
		return nil // 不存在就当成功
	}
	return dao.RefreshToken.RevokeByID(ctx, rt.ID)
}

// ListSessions 当前用户的全部活跃登录会话（前端「登录设备」列表）
// 只回非敏感字段：token_hash 绝不出网关；device_id 给前端标记「当前设备」用。
func (s *AuthService) ListSessions(ctx context.Context, userID string) ([]dto.SessionResp, error) {
	rows, err := dao.RefreshToken.ListActiveByUser(ctx, userID)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询登录设备失败")
	}
	list := make([]dto.SessionResp, 0, len(rows))
	for i := range rows {
		rt := rows[i]
		item := dto.SessionResp{
			ID:       rt.ID,
			DeviceID: rt.DeviceID,
			Platform: guessDevice(rt.DeviceID),
		}
		if rt.IP != nil {
			item.IP = *rt.IP
		}
		if !rt.CreatedAt.IsZero() {
			item.LoginAt = rt.CreatedAt.Format(time.RFC3339)
		}
		if !rt.ExpiresAt.IsZero() {
			item.ExpiresAt = rt.ExpiresAt.Format(time.RFC3339)
		}
		list = append(list, item)
	}
	return list, nil
}

// RevokeSession 退出指定的某一台设备
// 归属校验放在 SQL 的 WHERE 里（RevokeByIDAndUser）—— 前端传来的 id 不可信，
// 少了 user_id 过滤就等于「知道 id 就能把任何人踢下线」。
// 命中 0 行（不存在 / 不归当前用户 / 已撤销）一律静默成功：幂等，且不回显他人会话是否存在。
func (s *AuthService) RevokeSession(ctx context.Context, userID, sessionID string) error {
	if sessionID == "" {
		return gerror.NewCode(ecode.ResourceNotFound)
	}
	if _, err := dao.RefreshToken.RevokeByIDAndUser(ctx, sessionID, userID); err != nil {
		return gerror.WrapCode(ecode.DatabaseError, err, "退出该设备失败")
	}
	return nil
}

// ChangePassword 修改密码
// 1. 校验旧密码
// 2. 哈希新密码
// 3. 更新密码（同时版本号 +1）
// 4. 撤销该用户所有 refresh token（强制重新登录）
func (s *AuthService) ChangePassword(ctx context.Context, userID, oldPwd, newPwd string) error {
	user, err := dao.User.FindByID(ctx, userID)
	if err != nil {
		return gerror.NewCode(ecode.UserNotFound)
	}
	if !utility.VerifyPassword(user.PasswordHash, oldPwd) {
		return gerror.NewCode(ecode.AuthOldPasswordIncorrect)
	}
	if oldPwd == newPwd {
		return gerror.NewCode(ecode.PasswordSameAsOld)
	}
	hash, err := utility.HashPassword(newPwd)
	if err != nil {
		return gerror.WrapCode(ecode.InternalError, err, "密码哈希失败")
	}
	if err := dao.User.Update(ctx, userID, map[string]any{
		"password_hash":      hash,
		"version":            user.Version + 1,
		"pwd_reset_required": false, // 改密成功即解除「首登提示改密」（D-03 第六轮）
	}); err != nil {
		return gerror.WrapCode(ecode.DatabaseError, err, "更新密码失败")
	}
	// 撤销所有 token
	_ = dao.RefreshToken.RevokeByUser(ctx, userID)
	return nil
}

// ForgotPassword 申请重置密码
// 真实生产应发邮件，这里 MVP 把 token 打到日志（开发可见）
func (s *AuthService) ForgotPassword(ctx context.Context, email string) error {
	user, err := dao.User.FindByUsernameOrEmail(ctx, email)
	if err != nil {
		// 出于安全，不暴露邮箱是否存在
		return nil
	}
	token := utility.RandomToken()
	// 存进程内缓存 5 分钟（v1 替代 Redis）
	utility.PwdResetSet(token, user.ID, 5*time.Minute)
	g.Log("auth").Infof(ctx, "[DEV] reset token for %s = %s", user.Email, token)
	return nil
}

// ResetPassword 凭 token 重置
func (s *AuthService) ResetPassword(ctx context.Context, token, newPwd string) error {
	userID, ok := utility.PwdResetGet(token)
	if !ok {
		return gerror.NewCode(ecode.AuthTokenInvalid)
	}
	hash, err := utility.HashPassword(newPwd)
	if err != nil {
		return gerror.WrapCode(ecode.InternalError, err, "密码哈希失败")
	}
	if err := dao.User.Update(ctx, userID, map[string]any{
		"password_hash": hash,
	}); err != nil {
		return gerror.WrapCode(ecode.DatabaseError, err, "更新密码失败")
	}
	utility.PwdResetDel(token)
	_ = dao.RefreshToken.RevokeByUser(ctx, userID)
	return nil
}

// ====== 内部辅助 ======

func (s *AuthService) incrementFailedLogin(ctx context.Context, u *model.User) error {
	count := u.FailedLoginCount + 1
	updates := map[string]any{
		"failed_login_count": count,
	}
	if count >= 5 {
		updates["locked_until"] = time.Now().Add(10 * time.Minute)
	}
	return dao.User.Update(ctx, u.ID, updates)
}

func strPtr(s string) *string { return &s }
func strPtrOrNil(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
func derefStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// guessDevice 简单根据 device_id 前缀猜 mobile/desktop
func guessDevice(deviceID string) string {
	if strings.HasPrefix(deviceID, "m_") {
		return "mobile"
	}
	return "desktop"
}

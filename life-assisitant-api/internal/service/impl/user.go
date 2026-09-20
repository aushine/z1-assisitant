package impl

import (
	"context"
	"errors"
	"strings"

	"github.com/gogf/gf/v2/errors/gerror"
	"gorm.io/gorm"

	"github.com/life-assistant/api/internal/consts"
	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/dao"
	"github.com/life-assistant/api/internal/model"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/service"
	"github.com/life-assistant/api/internal/utility"
)

// UserService 用户服务
type UserService struct{}

func NewUserService() service.IUserService { return &UserService{} }

// Register 注册到 service 包（避免循环引用）
func init() { service.SetUser(NewUserService()) }

// GetMe 获取当前登录用户
func (s *UserService) GetMe(ctx context.Context, userID string) (*dto.UserResp, error) {
	u, err := dao.User.FindByID(ctx, userID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gerror.NewCode(ecode.UserNotFound)
		}
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询用户失败")
	}
	r := service.Permission().UserToDTO(u)
	return &r, nil
}

// GetUser 管理员获取指定用户
func (s *UserService) GetUser(ctx context.Context, id string) (*dto.UserResp, error) {
	u, err := dao.User.FindByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gerror.NewCode(ecode.UserNotFound)
		}
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询用户失败")
	}
	r := service.Permission().UserToDTO(u)
	return &r, nil
}

// ListUsers 列表
func (s *UserService) ListUsers(ctx context.Context, req *dto.ListUsersReq) ([]dto.UserResp, int64, error) {
	users, total, err := dao.User.List(ctx, dao.UserListOptions{
		Keyword:  req.Keyword,
		RoleCode: req.Role,
		Status:   req.Status,
		Page:     req.Page,
		PageSize: req.PageSize,
	})
	if err != nil {
		return nil, 0, gerror.WrapCode(ecode.DatabaseError, err, "查询用户列表失败")
	}
	out := make([]dto.UserResp, 0, len(users))
	for i := range users {
		out = append(out, service.Permission().UserToDTO(&users[i]))
	}
	return out, total, nil
}

// CreateUser 创建用户（管理员代建）
// 1. 校验角色存在
// 2. 统一初始密码 InitialPassword（D-03 第六轮），pwd_reset_required=1 首登提示改密
// 3. 创建 user
// 4. 角色 user_count +1
// 返回：用户对象 + 初始密码（明文，仅此一次）
func (s *UserService) CreateUser(ctx context.Context, operatorID string, req *dto.CreateUserReq) (*dto.UserResp, string, error) {
	// 唯一性检查（D-03 第六轮：email 可空，留空不查——空串会撞任意查询语义）
	if existing, _ := dao.User.FindByUsernameOrEmail(ctx, req.Username); existing != nil {
		return nil, "", gerror.NewCode(ecode.UserUsernameExists)
	}
	if req.Email != "" {
		if existing, _ := dao.User.FindByUsernameOrEmail(ctx, req.Email); existing != nil {
			return nil, "", gerror.NewCode(ecode.UserEmailExists)
		}
	}
	// 角色存在
	if _, err := dao.Role.FindByCode(ctx, req.Role); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, "", gerror.NewCode(ecode.RoleNotFound)
		}
		return nil, "", gerror.WrapCode(ecode.DatabaseError, err, "查询角色失败")
	}

	// D-03 第六轮：统一初始密码（随机 12 位交付麻烦；代建用户首登即被提示改密）
	initialPwd := InitialPassword
	hash, err := utility.HashPassword(initialPwd)
	if err != nil {
		return nil, "", gerror.WrapCode(ecode.InternalError, err, "密码哈希失败")
	}

	u := &model.User{
		ID:           utility.NewID("u"),
		Username:     req.Username,
		PasswordHash: hash,
		Name:         req.Name,
		Email:        req.Email,
		Phone:        strPtrOrNil(req.Phone),
		RoleCode:     req.Role,
		Department:   strPtrOrNil(req.Department),
		Status:           model.UserStatusActive,
		PwdResetRequired: true, // 代建用户一律首登提示改密（bool true 非零值，正常写列）
		Preferences:      model.JSON{"theme": "light", "language": "zh-CN"},
	}
	if err := dao.User.Create(ctx, u); err != nil {
		if strings.Contains(err.Error(), "Duplicate") || strings.Contains(err.Error(), "1062") {
			return nil, "", gerror.NewCode(ecode.DuplicateResource)
		}
		return nil, "", gerror.WrapCode(ecode.DatabaseError, err, "创建用户失败")
	}
	_ = dao.Role.IncUserCount(ctx, req.Role, 1)

	r := service.Permission().UserToDTO(u)
	return &r, initialPwd, nil
}

// UpdateUser 更新用户
func (s *UserService) UpdateUser(ctx context.Context, operatorID, id string, req *dto.UpdateUserReq) (*dto.UserResp, error) {
	// 不能改自己的 role
	if id == operatorID && req.Role != nil {
		return nil, gerror.NewCode(ecode.SelfProtection)
	}
	// 目标用户必须存在（同时取旧角色，供 user_count 维护比对——D-03 修复旧版漏维护）
	u, err := dao.User.FindByID(ctx, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gerror.NewCode(ecode.UserNotFound)
		}
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询用户失败")
	}
	// 角色存在性校验（D-03：编码不再硬编码枚举，以 roles 表为准）
	if req.Role != nil && *req.Role != u.RoleCode {
		if _, err := dao.Role.FindByCode(ctx, *req.Role); err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, gerror.NewCode(ecode.RoleNotFound)
			}
			return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询角色失败")
		}
	}
	// 不能把最后一个 admin 降级
	if req.Role != nil && *req.Role != model.RoleAdmin && u.RoleCode == model.RoleAdmin {
		count, _ := dao.User.CountByRole(ctx, model.RoleAdmin)
		if count <= 1 {
			return nil, gerror.NewCode(ecode.LastAdminProtected)
		}
	}

	updates := map[string]any{
		"version": req.Version + 1,
	}
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Email != nil {
		// D-03 第九轮：邮箱改可选——清空必须落 NULL（空串会撞 uk_email，UNIQUE 允许多 NULL）
		if *req.Email == "" {
			updates["email"] = nil
		} else {
			updates["email"] = *req.Email
		}
	}
	if req.Phone != nil {
		updates["phone"] = *req.Phone
	}
	if req.Avatar != nil {
		if !validAvatar(*req.Avatar) {
			return nil, gerror.New("头像需为 /uploads/ 受管路径或 http(s) 图片链接（上传请走 POST /users/me/avatar）")
		}
		updates["avatar"] = *req.Avatar
	}
	if req.Role != nil {
		updates["role_code"] = *req.Role
	}
	if req.Department != nil {
		updates["department"] = *req.Department
	}

	rows, err := dao.User.UpdateVersion(ctx, id, req.Version, updates)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "更新用户失败")
	}
	if rows == 0 {
		return nil, gerror.NewCode(ecode.VersionConflict)
	}
	// 角色变了 → 维护两侧 user_count
	if req.Role != nil && *req.Role != u.RoleCode {
		_ = dao.Role.IncUserCount(ctx, u.RoleCode, -1)
		_ = dao.Role.IncUserCount(ctx, *req.Role, 1)
	}
	// 重新查
	fresh, err := dao.User.FindByID(ctx, id)
	if err != nil {
		return nil, gerror.NewCode(ecode.UserNotFound)
	}
	r := service.Permission().UserToDTO(fresh)
	return &r, nil
}

// UpdateMe 当前用户自助更新个人资料
// 1. 只允许改 name / email / phone / avatar（struct 无 role/status/department 字段，杜绝提权）
// 2. 乐观锁：请求体可带 version（可选）；缺省时用服务端当前 version，避免前端拿不到 version 而 400
// 3. email 唯一性校验（改为他人邮箱时拒绝）
func (s *UserService) UpdateMe(ctx context.Context, userID string, req *dto.UpdateMeReq) (*dto.UserResp, error) {
	u, err := dao.User.FindByID(ctx, userID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gerror.NewCode(ecode.UserNotFound)
		}
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询用户失败")
	}

	// 乐观锁：仅在请求体显式携带 version 时校验，未携带则默认用服务端当前 version
	if req.Version != nil && *req.Version != u.Version {
		return nil, gerror.NewCode(ecode.VersionConflict)
	}

	// email 唯一性（改了且非空才查，排除自己；空串=清空，不参与查重）
	if req.Email != nil && *req.Email != "" && *req.Email != u.Email {
		if existing, _ := dao.User.FindByUsernameOrEmail(ctx, *req.Email); existing != nil && existing.ID != userID {
			return nil, gerror.NewCode(ecode.UserEmailExists)
		}
	}

	updates := map[string]any{"version": u.Version + 1}
	if req.Name != nil {
		updates["name"] = *req.Name
	}
	if req.Email != nil {
		// D-03 第九轮：可选清空 → NULL（空串会撞 uk_email）
		if *req.Email == "" {
			updates["email"] = nil
		} else {
			updates["email"] = *req.Email
		}
	}
	if req.Phone != nil {
		updates["phone"] = *req.Phone
	}
	if req.Avatar != nil {
		if !validAvatar(*req.Avatar) {
			return nil, gerror.New("头像需为 /uploads/ 受管路径或 http(s) 图片链接（上传请走 POST /users/me/avatar）")
		}
		updates["avatar"] = *req.Avatar
	}

	rows, err := dao.User.UpdateVersion(ctx, userID, u.Version, updates)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "更新用户失败")
	}
	if rows == 0 {
		return nil, gerror.NewCode(ecode.VersionConflict)
	}
	fresh, err := dao.User.FindByID(ctx, userID)
	if err != nil {
		return nil, gerror.NewCode(ecode.UserNotFound)
	}
	r := service.Permission().UserToDTO(fresh)
	return &r, nil
}

// SetAvatarURL 写新头像 URL 并返回旧值（文件落盘/清理由 controller 层负责）
func (s *UserService) SetAvatarURL(ctx context.Context, userID, url string) (string, error) {
	u, err := dao.User.FindByID(ctx, userID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return "", gerror.NewCode(ecode.UserNotFound)
		}
		return "", gerror.WrapCode(ecode.DatabaseError, err, "查询用户失败")
	}
	old := derefStr(u.Avatar)
	if err := dao.User.Update(ctx, userID, map[string]any{
		"avatar":  url,
		"version": u.Version + 1,
	}); err != nil {
		return "", gerror.WrapCode(ecode.DatabaseError, err, "更新头像失败")
	}
	return old, nil
}

// UpdateStatus 启用/禁用
func (s *UserService) UpdateStatus(ctx context.Context, operatorID, id string, req *dto.UpdateUserStatusReq) error {
	// 不能禁自己
	if id == operatorID {
		return gerror.NewCode(ecode.SelfProtection)
	}
	// 最后一个 admin 保护
	u, err := dao.User.FindByID(ctx, id)
	if err != nil {
		return gerror.NewCode(ecode.UserNotFound)
	}
	if u.RoleCode == model.RoleAdmin && req.Status == model.UserStatusDisabled {
		count, _ := dao.User.CountByRole(ctx, model.RoleAdmin)
		if count <= 1 {
			return gerror.NewCode(ecode.LastAdminProtected)
		}
	}

	updates := map[string]any{
		"status":  req.Status,
		"version": req.Version + 1,
	}
	if _, err := dao.User.UpdateVersion(ctx, id, req.Version, updates); err != nil {
		return gerror.WrapCode(ecode.DatabaseError, err, "更新状态失败")
	}
	// 禁用时撤销该用户所有 token
	if req.Status == model.UserStatusDisabled {
		_ = dao.RefreshToken.RevokeByUser(ctx, id)
	}
	return nil
}

// DeleteUser 删除（软删）
func (s *UserService) DeleteUser(ctx context.Context, operatorID, id string) error {
	if id == operatorID {
		return gerror.NewCode(ecode.SelfProtection)
	}
	u, err := dao.User.FindByID(ctx, id)
	if err != nil {
		return gerror.NewCode(ecode.UserNotFound)
	}
	// 最后一个 admin 保护
	if u.RoleCode == model.RoleAdmin {
		count, _ := dao.User.CountByRole(ctx, model.RoleAdmin)
		if count <= 1 {
			return gerror.NewCode(ecode.LastAdminProtected)
		}
	}
	if err := dao.User.SoftDelete(ctx, id); err != nil {
		return gerror.WrapCode(ecode.DatabaseError, err, "删除用户失败")
	}
	_ = dao.RefreshToken.RevokeByUser(ctx, id)
	_ = dao.Role.IncUserCount(ctx, u.RoleCode, -1)
	return nil
}

// InitialPassword 管理员代建用户的统一初始密码（D-03 第六轮）。
// 注：用户原话要求「123」，但登录页（冻结不可改）硬性校验密码 ≥6 位、
// ChangePasswordReq.old_password 也是 length:6,32——3 位密码双重不可行，
// 取最短可行值 123456；首登强制改密提示兜底安全风险。
const InitialPassword = "123456"

// validAvatar 头像字段白名单（D-03 第八轮：文件落盘方案，DB 只存 URL）：
// 本服务受管路径 /z1/uploads/...（第十三轮起，POST /users/me/avatar 产物）、
// 历史值 /uploads/...，或 http(s) 外链。
// data: base64 已废弃——曾把图片塞进 users.avatar，varchar(500) 直接 1406。
func validAvatar(s string) bool {
	return strings.HasPrefix(s, consts.UploadsPrefix+"/") ||
		strings.HasPrefix(s, consts.LegacyUploadsPrefix+"/") ||
		strings.HasPrefix(s, "http://") ||
		strings.HasPrefix(s, "https://")
}

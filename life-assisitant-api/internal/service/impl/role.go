package impl

import (
	"context"
	"errors"
	"regexp"
	"strings"

	"github.com/gogf/gf/v2/errors/gerror"
	"gorm.io/gorm"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/dao"
	"github.com/life-assistant/api/internal/model"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/service"
)

// roleCodeRe 自定义角色编码：小写字母开头 + a-z0-9_，总长 2-20
var roleCodeRe = regexp.MustCompile(`^[a-z][a-z0-9_]{1,19}$`)

// builtinRoleCodes 内置角色（禁创建/禁删除；名称描述可改，矩阵仅 user 可调、admin 锁定）
var builtinRoleCodes = map[string]bool{model.RoleAdmin: true, model.RoleUser: true}

// RoleService 角色服务
type RoleService struct{}

func NewRoleService() service.IRoleService { return &RoleService{} }

// Register 注册到 service 包（避免循环引用）
func init() { service.SetRole(NewRoleService()) }

func (s *RoleService) ListRoles(ctx context.Context) ([]dto.RoleResp, error) {
	roles, err := dao.Role.ListAll(ctx, )
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询角色列表失败")
	}
	out := make([]dto.RoleResp, 0, len(roles))
	for i := range roles {
		out = append(out, service.Permission().RoleToDTO(&roles[i]))
	}
	return out, nil
}

func (s *RoleService) GetRole(ctx context.Context, code string) (*dto.RoleResp, error) {
	r, err := dao.Role.FindByCode(ctx, code)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gerror.NewCode(ecode.RoleNotFound)
		}
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询角色失败")
	}
	rr := service.Permission().RoleToDTO(r)
	return &rr, nil
}

// AssignRole 给用户分配角色
func (s *RoleService) AssignRole(ctx context.Context, userID, roleCode string) error {
	// 检查角色存在
	if _, err := dao.Role.FindByCode(ctx, roleCode); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return gerror.NewCode(ecode.RoleNotFound)
		}
		return gerror.WrapCode(ecode.DatabaseError, err, "查询角色失败")
	}
	// 检查用户
	u, err := dao.User.FindByID(ctx, userID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return gerror.NewCode(ecode.UserNotFound)
		}
		return gerror.WrapCode(ecode.DatabaseError, err, "查询用户失败")
	}
	// 不能把最后一个 admin 改成非 admin
	if u.RoleCode == model.RoleAdmin && roleCode != model.RoleAdmin {
		count, _ := dao.User.CountByRole(ctx, model.RoleAdmin)
		if count <= 1 {
			return gerror.NewCode(ecode.LastAdminProtected)
		}
	}

	oldRole := u.RoleCode
	if err := dao.User.Update(ctx, userID, map[string]any{
		"role_code": roleCode,
		"version":   u.Version + 1,
	}); err != nil {
		return gerror.WrapCode(ecode.DatabaseError, err, "更新用户角色失败")
	}
	// 维护 user_count
	_ = dao.Role.IncUserCount(ctx, oldRole, -1)
	_ = dao.Role.IncUserCount(ctx, roleCode, 1)
	return nil
}

// ====== 自定义角色 CRUD（D-03 权限重构） ======

// CreateRole 新建自定义角色（is_system=false；初始矩阵为空，创建后到权限页勾选保存）
func (s *RoleService) CreateRole(ctx context.Context, req *dto.CreateRoleReq) (*dto.RoleResp, error) {
	code := strings.TrimSpace(req.Code)
	name := strings.TrimSpace(req.Name)
	if !roleCodeRe.MatchString(code) {
		return nil, gerror.NewCode(ecode.RoleCodeInvalid)
	}
	if builtinRoleCodes[code] {
		return nil, gerror.NewCodef(ecode.DuplicateResource, "内置角色编码 %s 不可占用", code)
	}
	if _, err := dao.Role.FindByCode(ctx, code); err == nil {
		return nil, gerror.NewCode(ecode.DuplicateResource)
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询角色失败")
	}

	r := &model.Role{
		Code:        code,
		Name:        name,
		Description: strPtrOrNil(strings.TrimSpace(req.Description)),
		IsSystem:    false,
		UserCount:   0,
	}
	if err := dao.Role.Create(ctx, r); err != nil {
		if strings.Contains(err.Error(), "Duplicate") || strings.Contains(err.Error(), "1062") {
			return nil, gerror.NewCode(ecode.DuplicateResource)
		}
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "创建角色失败")
	}
	out := service.Permission().RoleToDTO(r)
	return &out, nil
}

// UpdateRole 更新角色元信息（内置角色也可改显示名/描述；编码与矩阵不在此处动）
func (s *RoleService) UpdateRole(ctx context.Context, code string, req *dto.UpdateRoleReq) (*dto.RoleResp, error) {
	r, err := dao.Role.FindByCode(ctx, code)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gerror.NewCode(ecode.RoleNotFound)
		}
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询角色失败")
	}
	updates := map[string]any{}
	if req.Name != nil {
		n := strings.TrimSpace(*req.Name)
		if n == "" {
			return nil, gerror.NewCode(ecode.RoleCodeInvalid) // 名称不可清空
		}
		updates["name"] = n
	}
	if req.Description != nil {
		updates["description"] = strings.TrimSpace(*req.Description)
	}
	if len(updates) == 0 {
		out := service.Permission().RoleToDTO(r)
		return &out, nil
	}
	if err := dao.Role.UpdateMeta(ctx, code, updates); err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "更新角色失败")
	}
	fresh, err := dao.Role.FindByCode(ctx, code)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询角色失败")
	}
	out := service.Permission().RoleToDTO(fresh)
	return &out, nil
}

// DeleteRole 删除自定义角色：内置拒删；仍被用户引用（含软删，FK RESTRICT）拒删；连带清矩阵
func (s *RoleService) DeleteRole(ctx context.Context, code string) error {
	r, err := dao.Role.FindByCode(ctx, code)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return gerror.NewCode(ecode.RoleNotFound)
		}
		return gerror.WrapCode(ecode.DatabaseError, err, "查询角色失败")
	}
	if r.IsSystem {
		return gerror.NewCodef(ecode.RoleIsSystem, "内置角色 %s 不可删除", code)
	}
	// Unscoped：软删用户行仍持有 fk_user_role 外键，CountByRole（只数 active）会漏判
	var ref int64
	if err := dao.DB.WithContext(ctx).Model(&model.User{}).Unscoped().
		Where("role_code = ?", code).Count(&ref).Error; err != nil {
		return gerror.WrapCode(ecode.DatabaseError, err, "统计角色用户数失败")
	}
	if ref > 0 {
		return gerror.NewCodef(ecode.RoleInUse, "仍有 %d 个用户归属该角色（含已删除用户），请先为其改派角色", ref)
	}
	err = dao.DB.Transaction(func(tx *gorm.DB) error {
		if e := tx.Where("role_code = ?", code).Delete(&model.RolePermission{}).Error; e != nil {
			return e
		}
		return tx.Where("code = ?", code).Delete(&model.Role{}).Error
	})
	if err != nil {
		return gerror.WrapCode(ecode.DatabaseError, err, "删除角色失败")
	}
	return nil
}

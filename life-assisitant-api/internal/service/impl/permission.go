package impl

import (
	"context"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/gogf/gf/v2/errors/gerror"
	"github.com/gogf/gf/v2/frame/g"
	"gorm.io/gorm"

	"github.com/life-assistant/api/internal/consts"
	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/dao"
	"github.com/life-assistant/api/internal/model"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/service"
)

// PermissionService 权限服务
type PermissionService struct{}

func NewPermissionService() service.IPermissionService { return &PermissionService{} }

// Register 注册到 service 包（避免循环引用）
func init() { service.SetPermission(NewPermissionService()) }

func (s *PermissionService) ListPermissions(ctx context.Context) ([]dto.PermissionResp, error) {
	ps, err := dao.Permission.ListAllPermissions(ctx, )
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询权限列表失败")
	}
	out := make([]dto.PermissionResp, 0, len(ps))
	for i := range ps {
		out = append(out, s.PermissionToDTO(&ps[i]))
	}
	return out, nil
}

// GetRoleMatrix 获取角色权限矩阵
func (s *PermissionService) GetRoleMatrix(ctx context.Context, roleCode string) (*dto.PermissionMatrixResp, error) {
	// 验证角色存在
	r, err := dao.Role.FindByCode(ctx, roleCode)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gerror.NewCode(ecode.RoleNotFound)
		}
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询角色失败")
	}
	matrix, version, err := dao.Permission.GetMatrixByRole(ctx, roleCode)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询权限矩阵失败")
	}
	return &dto.PermissionMatrixResp{
		Role:      r.Code,
		Version:   version,
		UpdatedAt: r.UpdatedAt.Format(time.RFC3339),
		Matrix:    matrix,
	}, nil
}

// UpdateRoleMatrix 更新角色权限矩阵（D-03 重写）
// 修复三处旧缺陷：
//  1. 旧实现数完 count 就丢弃、req.Version 从未与当前版本比对——乐观锁是死代码，现真比对；
//  2. 旧实现静默忽略目录外的权限点，现未知点直接拒绝（400023，原因带出）；
//  3. admin 矩阵改为整体锁定不可改（旧「长度粗比较」可被补数量的残缺矩阵绕过）。
//     admin 的全权限由代码旁路 + 迁移 SQL 保证，不依赖这张表。
func (s *PermissionService) UpdateRoleMatrix(ctx context.Context, roleCode string, req *dto.UpdatePermissionMatrixReq) error {
	// 1. 角色存在
	r, err := dao.Role.FindByCode(ctx, roleCode)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return gerror.NewCode(ecode.RoleNotFound)
		}
		return gerror.WrapCode(ecode.DatabaseError, err, "查询角色失败")
	}
	// 2. admin 锁定
	if r.Code == model.RoleAdmin {
		return gerror.NewCode(ecode.AdminMatrixLocked)
	}

	// 3. 目录校验：matrix 中每个 "module:action" 必须存在于权限点表
	allPerms, err := dao.Permission.ListAllPermissions(ctx)
	if err != nil {
		return gerror.WrapCode(ecode.DatabaseError, err, "查询权限点失败")
	}
	idOf := make(map[string]string, len(allPerms))
	for _, p := range allPerms {
		idOf[p.Module+":"+p.Action] = p.ID
	}
	enabled := make(map[string]bool, len(allPerms))
	var unknown []string
	for module, actions := range req.Matrix {
		for _, action := range actions {
			point := module + ":" + action
			id, ok := idOf[point]
			if !ok {
				unknown = append(unknown, point)
				continue
			}
			enabled[id] = true
		}
	}
	if len(unknown) > 0 {
		sort.Strings(unknown)
		return gerror.NewCodef(ecode.UnknownPermissionPoint, "未知权限点: %s", strings.Join(unknown, ", "))
	}

	// 4. 乐观锁：比对提交版本与当前版本（空矩阵当前版本为 0）
	_, curVersion, err := dao.Permission.GetMatrixByRole(ctx, roleCode)
	if err != nil {
		return gerror.WrapCode(ecode.DatabaseError, err, "查询权限矩阵失败")
	}
	if req.Version != curVersion {
		return gerror.NewCodef(ecode.VersionConflict, "权限矩阵已被他人修改（当前 v%d，提交基于 v%d），请刷新后重试", curVersion, req.Version)
	}

	// 5. 全删全插。
	//    注：并发双写的窗口（4→5 之间）在单机管理台场景可接受；
	//    矩阵为空时没有行可携带版本，重开新勾选前版本恒 0，属已知无害边界。
	newVersion := curVersion + 1
	err = dao.DB.Transaction(func(tx *gorm.DB) error {
		tx = tx.WithContext(ctx)
		if err := tx.Where("role_code = ?", roleCode).Delete(&model.RolePermission{}).Error; err != nil {
			return err
		}
		rps := make([]model.RolePermission, 0, len(enabled))
		for permID := range enabled {
			rps = append(rps, model.RolePermission{
				RoleCode:     roleCode,
				PermissionID: permID,
				Enabled:      true,
				Version:      newVersion,
			})
		}
		if len(rps) > 0 {
			if err := tx.Create(&rps).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return gerror.WrapCode(ecode.DatabaseError, err, "更新权限矩阵失败")
	}
	return nil
}

// RoleHas 角色是否拥有任一给定权限点（"module:action"，ANY-of）
// admin 恒 true（全权限代码旁路，不查库）
func (s *PermissionService) RoleHas(ctx context.Context, roleCode string, points ...string) (bool, error) {
	if roleCode == model.RoleAdmin {
		return true, nil
	}
	if len(points) == 0 {
		return false, nil
	}
	matrix, _, err := dao.Permission.GetMatrixByRole(ctx, roleCode)
	if err != nil {
		return false, gerror.WrapCode(ecode.DatabaseError, err, "查询权限矩阵失败")
	}
	for _, p := range points {
		idx := strings.LastIndex(p, ":")
		if idx <= 0 {
			continue
		}
		module, action := p[:idx], p[idx+1:]
		for _, a := range matrix[module] {
			if a == action {
				return true, nil
			}
		}
	}
	return false, nil
}

// EnsureCatalog 启动自检：以 consts.PermissionCatalog 为权威目录做**只补不删**的自愈。
//
// 事故背景：新增权限点历史上只靠手写 SQL 增量脚本落库，漏跑 ⇒ 路由上的
// RequirePermission 对任何非 admin 角色恒返 403001（260922 的 category:* 就是这么炸的）。
// 目录升格为代码常量后，启动时按它补齐，杜绝"路由引用了目录里没有的点"。
//
// 三段行为：
//  1. permissions 缺失点 → INSERT（已存在则同步 description）；
//  2. admin → 补齐全目录（admin 语义即全权限，无争议）；
//  3. 其余角色 → **只告警不改写**：权限矩阵是管理员在权限页显式配置的成果，
//     自动补回会复活管理员刻意取消的勾选，故交给脚本 db/data_261001_perm_fix.sql。
func (s *PermissionService) EnsureCatalog(ctx context.Context) error {
	items := make([]model.Permission, 0, len(consts.PermissionCatalog))
	ids := make([]string, 0, len(consts.PermissionCatalog))
	for _, p := range consts.PermissionCatalog {
		desc := p.Description
		items = append(items, model.Permission{
			ID:          p.ID,
			Module:      p.Module,
			Action:      p.Action,
			Description: &desc,
		})
		ids = append(ids, p.ID)
	}

	// 1. 目录自愈
	if n, err := dao.Permission.UpsertCatalog(ctx, items); err != nil {
		return gerror.WrapCode(ecode.DatabaseError, err, "同步权限目录失败")
	} else if n > 0 {
		g.Log().Warningf(ctx, "🔧 权限目录自愈：写入/更新 %d 个权限点（目录共 %d 条）", n, len(items))
	}

	// 2. admin 全量
	if n, err := dao.Permission.GrantMissingToRole(ctx, model.RoleAdmin, ids); err != nil {
		return gerror.WrapCode(ecode.DatabaseError, err, "补齐 admin 权限矩阵失败")
	} else if n > 0 {
		g.Log().Warningf(ctx, "🔧 admin 权限矩阵自愈：补齐 %d 个权限点", n)
	}

	// 3. 其余角色基线校验（只告警）
	roles, err := dao.Role.ListAll(ctx)
	if err != nil {
		return gerror.WrapCode(ecode.DatabaseError, err, "查询角色列表失败")
	}
	for i := range roles {
		code := roles[i].Code
		if code == model.RoleAdmin {
			continue
		}
		matrix, _, err := dao.Permission.GetMatrixByRole(ctx, code)
		if err != nil {
			g.Log().Warningf(ctx, "⚠️  角色 %s 矩阵读取失败，跳过基线校验: %v", code, err)
			continue
		}
		missing := make([]string, 0, 8)
		for _, p := range consts.PermissionCatalog {
			if consts.IsAdminOnlyModule(p.Module) {
				continue
			}
			hit := false
			for _, a := range matrix[p.Module] {
				if a == p.Action {
					hit = true
					break
				}
			}
			if !hit {
				missing = append(missing, p.Module+":"+p.Action)
			}
		}
		if len(missing) > 0 {
			sort.Strings(missing)
			g.Log().Warningf(ctx,
				"⚠️  角色 %s 缺少 %d 个基线权限点，这些用户访问对应接口会 403：%s "+
					"（用 db/data_261001_perm_fix.sql 补齐，或到权限页勾选后保存）",
				code, len(missing), strings.Join(missing, ", "))
		}
	}
	return nil
}

// GetUserPermissions 获取某用户的有效权限
func (s *PermissionService) GetUserPermissions(ctx context.Context, userID string) (*dto.UserPermissionsResp, error) {
	u, err := dao.User.FindByID(ctx, userID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gerror.NewCode(ecode.UserNotFound)
		}
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询用户失败")
	}
	matrix, _, err := dao.Permission.GetMatrixByRole(ctx, u.RoleCode)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询权限矩阵失败")
	}
	// 展开成 "module:action" 列表
	perms := make([]string, 0)
	for module, actions := range matrix {
		for _, a := range actions {
			perms = append(perms, module+":"+a)
		}
	}
	return &dto.UserPermissionsResp{
		UserID:      u.ID,
		Role:        u.RoleCode,
		Permissions: perms,
		Matrix:      matrix,
	}, nil
}

// RoleToDTO model → DTO
func (s *PermissionService) RoleToDTO(r *model.Role) dto.RoleResp {
	return dto.RoleResp{
		ID:          r.ID,
		Code:        r.Code,
		Name:        r.Name,
		Description: derefStr(r.Description),
		IsSystem:    r.IsSystem,
		UserCount:   r.UserCount,
	}
}

// PermissionToDTO model → DTO
func (s *PermissionService) PermissionToDTO(p *model.Permission) dto.PermissionResp {
	return dto.PermissionResp{
		ID:          p.ID,
		Module:      p.Module,
		Action:      p.Action,
		Description: derefStr(p.Description),
	}
}

// UserToDTO model → DTO
func (s *PermissionService) UserToDTO(u *model.User) dto.UserResp {
	r := dto.UserResp{
		ID:        u.ID,
		Username:  u.Username,
		Name:      u.Name,
		Email:     u.Email,
		Phone:     derefStr(u.Phone),
		Avatar:    derefStr(u.Avatar),
		Role:      u.RoleCode,
		Department: derefStr(u.Department),
		Status:    u.Status,
		Version:   u.Version,
		// 初始密码未改标记（前端首登提示；UserResp 全端点透传）
		PwdResetRequired: u.PwdResetRequired,
	}
	if !u.CreatedAt.IsZero() {
		r.CreatedAt = u.CreatedAt.Format(time.RFC3339)
	}
	if !u.UpdatedAt.IsZero() {
		r.UpdatedAt = u.UpdatedAt.Format(time.RFC3339)
	}
	if u.LastLoginAt != nil {
		r.LastLoginAt = u.LastLoginAt.Format(time.RFC3339)
	}
	if u.LastLoginIP != nil {
		r.LastLoginIP = *u.LastLoginIP
	}
	if u.LastLoginDevice != nil {
		r.LastLoginDevice = *u.LastLoginDevice
	}
	return r
}

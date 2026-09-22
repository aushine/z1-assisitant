// Package impl 记账分类服务实现
//
// 业务规则：
//  1. 分类是**用户级**的；所有读写都按 ctx 里的 user_id 限定（内置 id 跨用户重复，
//     绝不能只按 id 查 —— 见 model/finance_category.go 的复合主键说明）。
//  2. 懒创建播种：GET 列表时若不存在任何 is_builtin=1 的行（**含已删除**）才播种（02 §4.2）。
//  3. name 1–10 字；同 (user, scope, parent_id) 下未删除行不可重名（06 §1.2）。
//  4. parent_id 必须是一级且 scope 一致；二级不能挂二级。
//  5. PATCH 改一级名 → 同事务级联重拼其二级的 full_name。
//  6. DELETE 软删（is_deleted=1 + deleted_at + deleted_seq=自身id）；删一级 → 同事务级联软删其全部二级。
//  7. 用户新建分类的 id 用 uuid 去横线（32 位），sort 从 900 起（天然排在末尾）。
package impl

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/gogf/gf/v2/errors/gerror"
	"gorm.io/gorm"

	"github.com/life-assistant/api/internal/consts/ecode"
	"github.com/life-assistant/api/internal/dao"
	"github.com/life-assistant/api/internal/model"
	"github.com/life-assistant/api/internal/model/dto"
	"github.com/life-assistant/api/internal/service"
	"github.com/life-assistant/api/internal/utility"
)

// FinanceCategoryService 记账分类服务实现
type FinanceCategoryService struct{}

func NewFinanceCategoryService() service.IFinanceCategoryService { return &FinanceCategoryService{} }

// Register 注册
func init() { service.SetFinanceCategory(NewFinanceCategoryService()) }

// 字段长度上限（06 §1.2：只校验长度与字符集，不校验图标白名单）
const (
	financeCategoryNameMaxLen  = 10
	financeCategoryIconMaxLen  = 40
	financeCategoryTintMaxLen  = 20
	financeCategoryEmojiMaxLen = 20
	// financeCategorySortBase 用户新建分类的起始 sort（内置项到 120）
	financeCategorySortBase = 900
)

// List 拉取分类树（含懒创建播种）
func (s *FinanceCategoryService) List(ctx context.Context, scope string) (*dto.ListFinanceCategoriesResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	if scope != "" && scope != model.FinanceCategoryScopeExpense && scope != model.FinanceCategoryScopeIncome {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}

	// 懒创建：判断「是否播种过」必须用 is_builtin=1 的行是否存在（含已删除行），
	// 不能用「当前分类数是否为 0」—— 否则用户把内置项全删光后再进会被重新塞满（02 §4.2）。
	seeded := false
	existsBuiltin, err := dao.FinanceCategory.ExistsBuiltin(ctx, uid)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询分类播种状态失败")
	}
	if !existsBuiltin {
		// 并发安全：BatchInsertIgnore 撞唯一索引/主键会静默跳过（幂等，无需显式事务）
		if err := dao.FinanceCategory.BatchInsertIgnore(ctx, buildSeedCategories(uid)); err != nil {
			return nil, gerror.WrapCode(ecode.DatabaseError, err, "播种内置分类失败")
		}
		seeded = true
	}

	items, err := dao.FinanceCategory.ListByUser(ctx, uid, scope)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询分类列表失败")
	}
	return &dto.ListFinanceCategoriesResp{
		Items:  buildCategoryTree(items),
		Seeded: seeded,
	}, nil
}

// Create 新建分类
func (s *FinanceCategoryService) Create(ctx context.Context, req *dto.CreateFinanceCategoryReq) (*dto.FinanceCategoryResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	if req == nil {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}

	scope := strings.TrimSpace(req.Scope)
	if scope != model.FinanceCategoryScopeExpense && scope != model.FinanceCategoryScopeIncome {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || utf8.RuneCountInString(name) > financeCategoryNameMaxLen {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}
	icon, err := validateOptionalLen(req.Icon, financeCategoryIconMaxLen)
	if err != nil {
		return nil, err
	}
	tint, err := validateOptionalLen(req.Tint, financeCategoryTintMaxLen)
	if err != nil {
		return nil, err
	}
	emoji, err := validateOptionalLen(req.Emoji, financeCategoryEmojiMaxLen)
	if err != nil {
		return nil, err
	}

	// 父分类校验：不为空时必须存在、未删除、是一级、scope 一致（二级不能挂二级）
	parentID := strings.TrimSpace(req.ParentID)
	fullName := name
	if parentID != "" {
		parent, err := dao.FinanceCategory.GetByID(ctx, uid, parentID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, gerror.NewCode(ecode.FinanceCategoryParentInvalid)
			}
			return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询父分类失败")
		}
		if parent.ParentID != utility.RootCategoryParent || parent.Scope != scope {
			return nil, gerror.NewCode(ecode.FinanceCategoryParentInvalid)
		}
		fullName = parent.Name + "-" + name
	}

	// 同 (user, scope, parent_id) 下未删除行不可重名
	dup, err := dao.FinanceCategory.ExistsActiveName(ctx, uid, scope, parentID, name, "")
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "校验分类名失败")
	}
	if dup {
		return nil, gerror.NewCode(ecode.FinanceCategoryNameExists)
	}

	c := &model.FinanceCategory{
		ID:        newFinanceCategoryID(),
		UserID:    uid,
		ParentID:  parentID,
		Scope:     scope,
		Name:      name,
		FullName:  &fullName,
		Sort:      financeCategorySortBase,
		IsBuiltin: false,
	}
	if icon != nil {
		c.Icon = icon
	}
	if tint != nil {
		c.Tint = tint
	}
	if emoji != nil {
		c.Emoji = emoji
	}

	if err := dao.FinanceCategory.Create(ctx, c); err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "创建分类失败")
	}
	return categoryToResp(c), nil
}

// Update 更新分类（name / icon / tint / emoji）
func (s *FinanceCategoryService) Update(ctx context.Context, id string, req *dto.UpdateFinanceCategoryReq) (*dto.FinanceCategoryResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	if req == nil {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}
	exist, err := dao.FinanceCategory.GetByID(ctx, uid, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gerror.NewCode(ecode.FinanceCategoryNotFound)
		}
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询分类失败")
	}

	updates := map[string]any{}
	nameChanged := false
	newName := exist.Name
	if req.Name != nil {
		n := strings.TrimSpace(*req.Name)
		if n == "" || utf8.RuneCountInString(n) > financeCategoryNameMaxLen {
			return nil, gerror.NewCode(ecode.ValidationFailed)
		}
		if n != exist.Name {
			dup, err := dao.FinanceCategory.ExistsActiveName(ctx, uid, exist.Scope, exist.ParentID, n, id)
			if err != nil {
				return nil, gerror.WrapCode(ecode.DatabaseError, err, "校验分类名失败")
			}
			if dup {
				return nil, gerror.NewCode(ecode.FinanceCategoryNameExists)
			}
			updates["name"] = n
			nameChanged = true
			newName = n
		}
	}
	for _, f := range []struct {
		key   string
		value *string
		max   int
	}{
		{"icon", req.Icon, financeCategoryIconMaxLen},
		{"tint", req.Tint, financeCategoryTintMaxLen},
		{"emoji", req.Emoji, financeCategoryEmojiMaxLen},
	} {
		if f.value == nil {
			continue
		}
		v, err := validateOptionalLen(*f.value, f.max)
		if err != nil {
			return nil, err
		}
		if v == nil {
			updates[f.key] = nil // 空串 = 清空（二级将继承父级）
		} else {
			updates[f.key] = *v
		}
	}
	if len(updates) == 0 {
		return categoryToResp(exist), nil
	}

	// full_name 只在改名时重算：一级 = name；二级 = 「父 full_name - name」
	if nameChanged {
		fullName := newName
		if exist.ParentID != utility.RootCategoryParent {
			parentFull := ""
			if parent, perr := dao.FinanceCategory.GetByID(ctx, uid, exist.ParentID); perr == nil {
				parentFull = parent.Name
				if parent.FullName != nil && *parent.FullName != "" {
					parentFull = *parent.FullName
				}
			}
			if parentFull != "" {
				fullName = parentFull + "-" + newName
			}
		}
		updates["full_name"] = fullName
	}

	if nameChanged && exist.ParentID == utility.RootCategoryParent {
		// ⚠️ 改一级名 → 更新自身 + 级联重拼所有二级 full_name，**必须同事务**（06 §5）
		err = dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			if err := tx.Model(&model.FinanceCategory{}).
				Where("user_id = ? AND id = ?", uid, id).
				Updates(updates).Error; err != nil {
				return err
			}
			return tx.Model(&model.FinanceCategory{}).
				Where("user_id = ? AND parent_id = ? AND is_deleted = 0", uid, id).
				Update("full_name", gorm.Expr("CONCAT(?, '-', name)", newName)).Error
		})
	} else {
		err = dao.FinanceCategory.Update(ctx, uid, id, updates)
	}
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "更新分类失败")
	}

	fresh, err := dao.FinanceCategory.GetByID(ctx, uid, id)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "重新查询分类失败")
	}
	return categoryToResp(fresh), nil
}

// Delete 软删除分类（删一级时级联软删其二级）
func (s *FinanceCategoryService) Delete(ctx context.Context, id string) error {
	uid := ctxUserID(ctx)
	if uid == "" {
		return gerror.NewCode(ecode.AuthTokenMissing)
	}
	exist, err := dao.FinanceCategory.GetByID(ctx, uid, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return gerror.NewCode(ecode.FinanceCategoryNotFound)
		}
		return gerror.WrapCode(ecode.DatabaseError, err, "查询分类失败")
	}

	// ⚠️ 软删三件套一起写：is_deleted = 1 + deleted_at = NOW() + deleted_seq = 自身 id。
	// deleted_seq 写自身 id 后，该行在 uk 末列占用一个全库唯一值，
	// 「同名分类反复删除」不会再撞 uk（02 §1 改版：uk 末列从 is_deleted 改成了 deleted_seq）。
	// 级联删二级时，每个子级各自写自己的 id。
	now := time.Now()
	err = dao.DB.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&model.FinanceCategory{}).
			Where("user_id = ? AND id = ? AND is_deleted = 0", uid, id).
			Updates(map[string]any{
				"is_deleted":  1,
				"deleted_at":  now,
				"deleted_seq": gorm.Expr("id"),
			}).Error; err != nil {
			return err
		}
		// 删一级 → 级联软删其全部二级（同事务，06 §1.4），每个子级同样写各自 id
		if exist.ParentID == utility.RootCategoryParent {
			if err := tx.Model(&model.FinanceCategory{}).
				Where("user_id = ? AND parent_id = ? AND is_deleted = 0", uid, id).
				Updates(map[string]any{
					"is_deleted":  1,
					"deleted_at":  now,
					"deleted_seq": gorm.Expr("id"),
				}).Error; err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return gerror.WrapCode(ecode.DatabaseError, err, "删除分类失败")
	}
	return nil
}

// ====== 内部辅助 ======

// validateOptionalLen 去空白后校验长度；空串返回 nil（表示清空 / 未填）
func validateOptionalLen(s string, max int) (*string, error) {
	v := strings.TrimSpace(s)
	if v == "" {
		return nil, nil
	}
	if utf8.RuneCountInString(v) > max {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}
	return &v, nil
}

// newFinanceCategoryID 用户新建分类的 id：uuid 去横线（32 位），与内置 fc_b_ 前缀区分（03 §6）
func newFinanceCategoryID() string {
	return strings.ReplaceAll(utility.NewUUID(), "-", "")
}

// buildSeedCategories 把种子常量展开为某个用户的实体列表（复用 utility 的唯一真源）
func buildSeedCategories(uid string) []model.FinanceCategory {
	return utility.BuildSeedCategories(uid)
}

// categoryToResp 实体 → DTO
func categoryToResp(c *model.FinanceCategory) *dto.FinanceCategoryResp {
	full := ""
	if c.FullName != nil {
		full = *c.FullName
	}
	return &dto.FinanceCategoryResp{
		ID:        c.ID,
		ParentID:  c.ParentID,
		Scope:     c.Scope,
		Name:      c.Name,
		FullName:  full,
		Emoji:     c.Emoji,
		Icon:      c.Icon,
		Tint:      c.Tint,
		Sort:      c.Sort,
		IsBuiltin: c.IsBuiltin,
		Children:  []dto.FinanceCategoryResp{},
	}
}

// buildCategoryTree 把扁平列表（已按 scope → 一级在前 → sort 排好）组装成两级树
func buildCategoryTree(items []model.FinanceCategory) []dto.FinanceCategoryResp {
	nodes := make(map[string]*dto.FinanceCategoryResp, len(items))
	roots := make([]*dto.FinanceCategoryResp, 0, len(items))
	for i := range items {
		c := &items[i]
		node := categoryToResp(c)
		nodes[c.ID] = node
		if c.ParentID == utility.RootCategoryParent {
			roots = append(roots, node)
		}
	}
	for i := range items {
		c := &items[i]
		if c.ParentID == utility.RootCategoryParent {
			continue
		}
		if parent, ok := nodes[c.ParentID]; ok {
			parent.Children = append(parent.Children, *categoryToResp(c))
		}
	}
	out := make([]dto.FinanceCategoryResp, 0, len(roots))
	for _, r := range roots {
		out = append(out, *r)
	}
	return out
}

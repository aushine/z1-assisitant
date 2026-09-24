// Package impl 习惯/待办分类服务实现（user_categories）
//
// 业务规则（06 §3）：
//  1. 分类是**用户级**的；所有读写都按 ctx 里的 user_id 限定（内置 id 跨用户重复，
//     绝不能只按 id 查 —— 见 model/user_category.go 的复合主键说明）。
//  2. 懒创建播种：GET 列表时若该用户该 domain 不存在任何 is_builtin=1 的行
//     （**含已删除行**）才播种内置 4 / 6 条（06 §3.1 铁律 3）。
//  3. name 1–10 字；同 (user, domain) 下未删除行不可重名。
//  4. DELETE 软删三件套一起写：is_deleted=1 + deleted_at=now + deleted_seq=随机值
//     （06 §3.3：漏 deleted_seq 会让「同名删了再建/再删」撞 1062）。
//  5. 新建分类 id 规则：uc_<domain>_<10 位随机>（06 §3.2）；sort 从 900 起（排在内置项后）。
//  6. domain 不允许修改（UpdateReq 刻意不含该字段）；错误码复用 ValidationFailed 400001
//     与 ResourceNotFound 404001（本批不新增 ecode）。
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

// UserCategoryService 习惯/待办分类服务实现
type UserCategoryService struct{}

func NewUserCategoryService() service.IUserCategoryService { return &UserCategoryService{} }

// Register 注册
func init() { service.SetUserCategory(NewUserCategoryService()) }

// 字段长度上限（与 user_categories DDL 一致；图标白名单不校验，只校验长度）
const (
	userCategoryNameMaxLen  = 10
	userCategoryIconMaxLen  = 40
	userCategoryTintMaxLen  = 20
	userCategoryEmojiMaxLen = 20
	// userCategorySortBase 用户新建分类的起始 sort（内置项到 60）
	userCategorySortBase = 900
	// userCategoryRandomSeqLen deleted_seq 随机值长度（uuid 去横线后取前 32 位，列长 32）
	userCategoryRandomSeqLen = 32
)

// List 拉取分类列表（含懒创建播种）
func (s *UserCategoryService) List(ctx context.Context, domain string) (*dto.ListUserCategoriesResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	domain = strings.TrimSpace(domain)
	if !isValidUserCategoryDomain(domain) {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}

	// 懒创建：判断「是否播种过」必须用 is_builtin=1 的行是否存在（含已删除行），
	// 不能用「当前分类数是否为 0」—— 否则用户把内置项全删光后再进会被重新塞满（06 §3.1 铁律 3）。
	seeded, err := seedUserCategoriesIfAbsent(ctx, uid, domain)
	if err != nil {
		return nil, err
	}

	items, err := dao.UserCategory.ListByDomain(ctx, uid, domain)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询分类列表失败")
	}
	out := make([]dto.UserCategoryResp, 0, len(items))
	for i := range items {
		out = append(out, *userCategoryToResp(&items[i]))
	}
	return &dto.ListUserCategoriesResp{Items: out, Seeded: seeded}, nil
}

// Create 新建分类
func (s *UserCategoryService) Create(ctx context.Context, req *dto.CreateUserCategoryReq) (*dto.UserCategoryResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	if req == nil {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}

	domain := strings.TrimSpace(req.Domain)
	if !isValidUserCategoryDomain(domain) {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}
	name := strings.TrimSpace(req.Name)
	if name == "" || utf8.RuneCountInString(name) > userCategoryNameMaxLen {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}
	parentID := strings.TrimSpace(req.ParentID)
	// parent_id 非空时为二级：父必须存在、必须是同域一级分类（R3）
	parentName := ""
	if parentID != "" {
		if parentID == name {
			return nil, gerror.NewCode(ecode.ValidationFailed)
		}
		parent, err := dao.UserCategory.GetByID(ctx, uid, parentID)
		if err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, gerror.NewCode(ecode.ValidationFailed)
			}
			return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询父分类失败")
		}
		if parent.Domain != domain || !parent.IsTopLevel() {
			return nil, gerror.NewCode(ecode.ValidationFailed)
		}
		parentName = parent.Name
	}
	icon, err := validateOptionalLen(req.Icon, userCategoryIconMaxLen)
	if err != nil {
		return nil, err
	}
	emoji, err := validateOptionalLen(req.Emoji, userCategoryEmojiMaxLen)
	if err != nil {
		return nil, err
	}
	tint, err := validateOptionalLen(req.Tint, userCategoryTintMaxLen)
	if err != nil {
		return nil, err
	}

	// 同 (user, domain, parent) 下未删除行不可重名（与 uk_user_cat 活跃行口径一致）
	dup, err := dao.UserCategory.ExistsActiveName(ctx, uid, domain, parentID, name, "")
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "校验分类名失败")
	}
	if dup {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}

	// full_name：一级 = name；二级 = 「父名-子名」
	fullName := name
	if parentID != "" {
		fullName = parentName + "-" + name
	}

	c := &model.UserCategory{
		ID:       newUserCategoryID(domain),
		UserID:   uid,
		Domain:   domain,
		ParentID: parentID,
		Name:     name,
		FullName: fullName,
		Tint:     "neutral", // DDL 默认值；显式写入避免 GORM 零值省略后依赖列默认
		Sort:     userCategorySortBase,
	}
	if icon != nil {
		c.Icon = *icon
	}
	if emoji != nil {
		c.Emoji = *emoji
	}
	if tint != nil {
		c.Tint = *tint
	}

	if err := dao.UserCategory.Create(ctx, c); err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "创建分类失败")
	}
	return userCategoryToResp(c), nil
}

// Update 更新分类（name / icon / emoji / tint；不可改 domain）
func (s *UserCategoryService) Update(ctx context.Context, id string, req *dto.UpdateUserCategoryReq) (*dto.UserCategoryResp, error) {
	uid := ctxUserID(ctx)
	if uid == "" {
		return nil, gerror.NewCode(ecode.AuthTokenMissing)
	}
	if req == nil {
		return nil, gerror.NewCode(ecode.ValidationFailed)
	}
	exist, err := dao.UserCategory.GetByID(ctx, uid, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, gerror.NewCode(ecode.ResourceNotFound)
		}
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "查询分类失败")
	}

	updates := map[string]any{}
	if req.Name != nil {
		n := strings.TrimSpace(*req.Name)
		if n == "" || utf8.RuneCountInString(n) > userCategoryNameMaxLen {
			return nil, gerror.NewCode(ecode.ValidationFailed)
		}
		if n != exist.Name {
			dup, err := dao.UserCategory.ExistsActiveName(ctx, uid, exist.Domain, exist.ParentID, n, id)
			if err != nil {
				return nil, gerror.WrapCode(ecode.DatabaseError, err, "校验分类名失败")
			}
			if dup {
				return nil, gerror.NewCode(ecode.ValidationFailed)
			}
			updates["name"] = n
			// full_name 随改名重算：一级 = n；二级 = 「父名-n」
			if exist.ParentID == "" {
				updates["full_name"] = n
			} else {
				parent, perr := dao.UserCategory.GetByID(ctx, uid, exist.ParentID)
				if perr == nil && parent != nil {
					updates["full_name"] = parent.Name + "-" + n
				} else {
					updates["full_name"] = n
				}
			}
		}
	}
	for _, f := range []struct {
		key   string
		value *string
		max   int
	}{
		{"icon", req.Icon, userCategoryIconMaxLen},
		{"emoji", req.Emoji, userCategoryEmojiMaxLen},
		{"tint", req.Tint, userCategoryTintMaxLen},
	} {
		if f.value == nil {
			continue
		}
		v, err := validateOptionalLen(*f.value, f.max)
		if err != nil {
			return nil, err
		}
		if v == nil {
			// 空串 = 清空（列有 NOT NULL DEFAULT，写各列默认值：tint 回 neutral）
			if f.key == "tint" {
				updates[f.key] = "neutral"
			} else {
				updates[f.key] = ""
			}
		} else {
			updates[f.key] = *v
		}
	}
	if len(updates) == 0 {
		return userCategoryToResp(exist), nil
	}

	if err := dao.UserCategory.Update(ctx, uid, id, updates); err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "更新分类失败")
	}
	// 一级改名后，其下二级的 full_name（「父名-子名」）同步重算（保持展示一致）。
	// 失败不阻断（full_name 仅为展示便利字段），仅记日志。
	if exist.IsTopLevel() {
		if newName, ok := updates["name"]; ok {
			if children, cerr := dao.UserCategory.ListChildren(ctx, uid, exist.ID); cerr == nil {
				for _, ch := range children {
					_ = dao.UserCategory.Update(ctx, uid, ch.ID, map[string]any{
						"full_name": newName.(string) + "-" + ch.Name,
					})
				}
			}
		}
	}
	fresh, err := dao.UserCategory.GetByID(ctx, uid, id)
	if err != nil {
		return nil, gerror.WrapCode(ecode.DatabaseError, err, "重新查询分类失败")
	}
	return userCategoryToResp(fresh), nil
}

// Delete 软删除分类（三件套一起写）。
//
// R3-1 级联规则：删除**一级**分类时，其下所有**未删**二级一并级联软删（同事务逐条写）。
// 挂在这些二级上的 habits.category / tasks.category_id **保留**（存量引用不回滚，
// 仅分类列表不再显示；统计对已删分类的归集自然失效）。
func (s *UserCategoryService) Delete(ctx context.Context, id string) error {
	uid := ctxUserID(ctx)
	if uid == "" {
		return gerror.NewCode(ecode.AuthTokenMissing)
	}
	exist, err := dao.UserCategory.GetByID(ctx, uid, id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return gerror.NewCode(ecode.ResourceNotFound)
		}
		return gerror.WrapCode(ecode.DatabaseError, err, "查询分类失败")
	}
	// R3-1：一级级联软删其下二级
	if exist.IsTopLevel() {
		children, cerr := dao.UserCategory.ListChildren(ctx, uid, exist.ID)
		if cerr != nil {
			return gerror.WrapCode(ecode.DatabaseError, cerr, "查询子分类失败")
		}
		for i := range children {
			if err := softDeleteOne(ctx, uid, children[i].ID); err != nil {
				return err
			}
		}
	}
	return softDeleteOne(ctx, uid, exist.ID)
}

// softDeleteOne 软删单个分类（三件套：is_deleted=1 + deleted_at=now + deleted_seq=随机值）。
// ⚠️ deleted_seq 写随机值（而非自身 id —— id 跨用户重复，复合主键下不构成唯一）后，
// 该行在 uk_user_cat 末列占用一个不重复值，「同名反复删除」不会撞 1062（06 §3.3）。
func softDeleteOne(ctx context.Context, uid, id string) error {
	seq := strings.ReplaceAll(utility.NewUUID(), "-", "")
	if seqLen := len(seq); seqLen > userCategoryRandomSeqLen {
		seq = seq[:userCategoryRandomSeqLen]
	}
	if err := dao.UserCategory.SoftDelete(ctx, uid, id, seq, time.Now()); err != nil {
		return gerror.WrapCode(ecode.DatabaseError, err, "删除分类失败")
	}
	return nil
}

// ====== 对外复用的包内辅助（habit / task 归属校验与懒播种） ======

// seedUserCategoriesIfAbsent 该用户该 domain 未播种过则补内置种子（幂等、并发安全）。
// 返回 seeded = 本次是否真的触发了播种。
func seedUserCategoriesIfAbsent(ctx context.Context, uid, domain string) (bool, error) {
	existsBuiltin, err := dao.UserCategory.ExistsBuiltin(ctx, uid, domain)
	if err != nil {
		return false, gerror.WrapCode(ecode.DatabaseError, err, "查询分类播种状态失败")
	}
	if existsBuiltin {
		return false, nil
	}
	// 并发安全：BatchInsertIgnore 撞主键/唯一索引会静默跳过（幂等，无需显式事务）
	if err := dao.UserCategory.BatchInsertIgnore(ctx, utility.BuildUserCategories(uid, domain)); err != nil {
		return false, gerror.WrapCode(ecode.DatabaseError, err, "播种内置分类失败")
	}
	return true, nil
}

// validateCategoryOwnership 归属校验（06 §3.4）：categoryID 必须是
// userID 名下、指定 domain、未删除的 user_categories.id，否则 ValidationFailed(400001)。
//   - categoryID 为空串 = 未分类，直接放行（tasks.category_id 允许为空）；
//   - 管理员代改他人数据时，userID 传**记录属主**（如 exist.UserID），不是操作者。
func validateCategoryOwnership(ctx context.Context, userID, domain, categoryID string) error {
	categoryID = strings.TrimSpace(categoryID)
	if categoryID == "" {
		return nil
	}
	cat, err := dao.UserCategory.GetByID(ctx, userID, categoryID)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return gerror.NewCode(ecode.ValidationFailed)
		}
		return gerror.WrapCode(ecode.DatabaseError, err, "校验分类归属失败")
	}
	if cat.Domain != domain {
		return gerror.NewCode(ecode.ValidationFailed)
	}
	return nil
}

// ====== 内部辅助 ======

// isValidUserCategoryDomain domain 白名单
func isValidUserCategoryDomain(domain string) bool {
	return domain == model.UserCategoryDomainHabit || domain == model.UserCategoryDomainTask
}

// newUserCategoryID 用户新建分类的 id：uc_<domain>_<10 位随机>（06 §3.2）；
// 与内置旧值（sport / c_work…）天然不撞
func newUserCategoryID(domain string) string {
	clean := strings.ReplaceAll(utility.NewUUID(), "-", "")
	if len(clean) > 10 {
		clean = clean[:10]
	}
	return "uc_" + domain + "_" + clean
}

// userCategoryToResp 实体 → DTO
func userCategoryToResp(c *model.UserCategory) *dto.UserCategoryResp {
	// full_name 兜底：存量一级行可能为空（迁移前），一级用 name
	fullName := c.FullName
	if fullName == "" {
		fullName = c.Name
	}
	return &dto.UserCategoryResp{
		ID:        c.ID,
		Domain:    c.Domain,
		ParentID:  c.ParentID,
		Name:      c.Name,
		FullName:  fullName,
		Emoji:     c.Emoji,
		Icon:      c.Icon,
		Tint:      c.Tint,
		Sort:      c.Sort,
		IsBuiltin: c.IsBuiltin,
	}
}

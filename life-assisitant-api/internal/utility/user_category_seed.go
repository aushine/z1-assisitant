// Package utility 习惯/待办分类种子（内置分类清单的**唯一真源**，user_categories）
//
// 来源：md/spec-20260922-v2/04-习惯与待办分类图标.md §2.3 / 06 §3.2。
// habit 4 条（sport/diet/life/study）+ task 6 条（c_work…c_other）= 10 条种子，
// 每个用户按其接触的 domain 懒创建播种（每人一份）。
//
// ⚠️ 为什么不写进 SQL：
//  1. 分类是**用户级**的（每人一份），SQL 里写死 user_id 不可行；
//  2. 两端不重复维护 —— 前端从 GET /user-categories 拉取；
//  3. 便于用固定 id 做「懒创建」的幂等播种（见 service/impl/user_category.go）。
//
// ⚠️ 硬约束（06 §3.2）：**内置 id 保留旧值** —— habits.category 与 tasks.category_id
// 的存量数据直接命中这些 id ⇒ 零迁移、零回填、dao.Task.GroupByCategory 一行不用改。
// 新键值与两端 utils/category-dict.ts 的展示字典逐字对齐（id/name/emoji/icon/tint）。
//
// icon 落库格式：`lucide:<PascalCase 名>`（带前缀，DDL COMMENT 'lucide:Pin'，04 §4.3）。
// 新建（非内置）分类的 id 规则：uc_<domain>_<10 位随机>（见 service/impl/user_category.go）。
package utility

import (
	"time"

	"github.com/life-assistant/api/internal/model"
)

// UserCategorySeed 内置分类种子条目（habit / task 两域统一结构）
type UserCategorySeed struct {
	ID     string // 固定 id（保留旧值）：habit=sport…；task=c_work…
	Domain string // habit / task
	Name   string // 显示名
	Emoji  string // emoji（与旧渲染兼容）
	Icon   string // `lucide:<Name>` 形式
	Tint   string // 语义色名
	Sort   int    // 越小越前；内置项 10/20/30…
}

// userCategorySeeds 全量内置种子（顺序：habit 4 条 → task 6 条；值对齐两端 category-dict.ts）
var userCategorySeeds = []UserCategorySeed{
	// ====== 习惯域（4）：id 即旧 habits.category 枚举值 ======
	{ID: "sport", Domain: model.UserCategoryDomainHabit, Name: "运动", Emoji: "💪", Icon: "lucide:Dumbbell", Tint: "success", Sort: 10},
	{ID: "diet", Domain: model.UserCategoryDomainHabit, Name: "饮食", Emoji: "🍎", Icon: "lucide:Apple", Tint: "danger", Sort: 20},
	{ID: "life", Domain: model.UserCategoryDomainHabit, Name: "生活", Emoji: "🏠", Icon: "lucide:Home", Tint: "success", Sort: 30},
	{ID: "study", Domain: model.UserCategoryDomainHabit, Name: "学习", Emoji: "📚", Icon: "lucide:BookOpen", Tint: "accent", Sort: 40},
	// ====== 待办域（6）：id 即旧 tasks.category_id 存量值 ======
	{ID: "c_work", Domain: model.UserCategoryDomainTask, Name: "工作", Emoji: "💼", Icon: "lucide:Briefcase", Tint: "primary", Sort: 10},
	{ID: "c_study", Domain: model.UserCategoryDomainTask, Name: "学习", Emoji: "📚", Icon: "lucide:BookOpen", Tint: "accent", Sort: 20},
	{ID: "c_life", Domain: model.UserCategoryDomainTask, Name: "生活", Emoji: "🏠", Icon: "lucide:Home", Tint: "success", Sort: 30},
	{ID: "c_health", Domain: model.UserCategoryDomainTask, Name: "健康", Emoji: "💪", Icon: "lucide:Dumbbell", Tint: "success", Sort: 40},
	{ID: "c_social", Domain: model.UserCategoryDomainTask, Name: "社交", Emoji: "👥", Icon: "lucide:Users", Tint: "accent", Sort: 50},
	{ID: "c_other", Domain: model.UserCategoryDomainTask, Name: "其他", Emoji: "📌", Icon: "lucide:Pin", Tint: "neutral", Sort: 60},
}

// UserCategorySeeds 返回内置分类种子的副本（调用方可安全修改，不污染全局表）
func UserCategorySeeds() []UserCategorySeed {
	out := make([]UserCategorySeed, len(userCategorySeeds))
	copy(out, userCategorySeeds)
	return out
}

// BuildUserCategories 把种子常量展开为「某个具体用户某个 domain」的分类实体切片（每人一份）。
//
// 服务端的懒播种（service/impl/user_category.go）按 domain 调用本函数，
// 保证 habit / task 两域各自幂等（ExistsBuiltin 含已删行判断，06 §3.1 铁律 3）。
// 活跃行 deleted_seq 为空串（默认），由 uk_user_cat 前几列保唯一；种子全部 is_builtin=true。
func BuildUserCategories(userID, domain string) []model.UserCategory {
	now := time.Now()
	out := make([]model.UserCategory, 0, len(userCategorySeeds))
	for _, s := range userCategorySeeds {
		if s.Domain != domain {
			continue
		}
		out = append(out, model.UserCategory{
			ID:        s.ID,
			UserID:    userID,
			Domain:    s.Domain,
			Name:      s.Name,
			Emoji:     s.Emoji,
			Icon:      s.Icon,
			Tint:      s.Tint,
			Sort:      s.Sort,
			IsBuiltin: true,
			CreatedAt: now,
			UpdatedAt: now,
		})
	}
	return out
}

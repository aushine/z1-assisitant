// Package utility 习惯/待办分类种子（内置分类清单的**唯一真源**，user_categories）
//
// 来源：md/spec-20260922-v2/04-习惯与待办分类图标.md §2.3 / 06 §3.2，
//       **R3 两级分类**（md/spec-20260924-v1/03）在 2026-09-24 扩展为两级。
// habit 一级 4 条（sport/diet/life/study）+ 二级 18 条；
// task  一级 6 条（c_work…c_other）+ 二级 16 条；共 44 条种子，
// 每个用户按其接触的 domain 懒创建播种（每人一份）。
//
// ⚠️ 为什么不写进 SQL：
//  1. 分类是**用户级**的（每人一份），SQL 里写死 user_id 不可行；
//  2. 两端不重复维护 —— 前端从 GET /user-categories 拉取；
//  3. 便于用固定 id 做「懒创建」的幂等播种（见 service/impl/user_category.go）。
//
// ⚠️ 硬约束（06 §3.2）：**内置一级 id 保留旧值** —— habits.category 与 tasks.category_id
// 的存量数据直接命中这些 id ⇒ 零迁移、零回填、dao.Task.GroupByCategory 一行不用改。
// 新键值与两端 utils/category-dict.ts 的展示字典逐字对齐（id/name/emoji/icon/tint）。
//
// ⚠️ 内置二级 id 规则 `<父id>_NN`（NN 从 01 起，03 §3.3）；
//    用户新建分类 id 规则 uc_<domain>_<10 位随机>（见 service/impl/user_category.go），
//    与内置 `<父id>_NN` 天然不撞。
//
// icon 落库格式：`lucide:<PascalCase 名>`（带前缀，DDL COMMENT 'lucide:Pin'，04 §4.3）。
// ⚠️ 图标名必须在本端 lucide 0.300.0 实测存在（两端同名同版本），且已核对。
package utility

import (
	"time"

	"github.com/life-assistant/api/internal/model"
)

// UserCategorySeed 内置分类种子条目（habit / task 两域统一结构，支持两级）
type UserCategorySeed struct {
	ID       string // 固定 id：一级保留旧值（sport…/c_work…）；二级 `<父id>_NN`
	Domain   string // habit / task
	ParentID string // 空串 = 一级；二级指向同域一级的 id
	Name     string // 显示名
	Emoji    string // emoji（与旧渲染兼容）
	Icon     string // `lucide:<Name>` 形式
	Tint     string // 语义色名
	Sort     int    // 越小越前；一级 10/20…；二级在其父下 10/20…
}

// userCategorySeeds 全量内置种子（顺序：先全部一级 → 再全部二级；值对齐两端 category-dict.ts）
var userCategorySeeds = []UserCategorySeed{
	// ==================== 一级：习惯域（4） id 即旧 habits.category 枚举值 ====================
	{ID: "sport", Domain: model.UserCategoryDomainHabit, Name: "运动", Emoji: "💪", Icon: "lucide:Dumbbell", Tint: "success", Sort: 10},
	{ID: "diet", Domain: model.UserCategoryDomainHabit, Name: "饮食", Emoji: "🍎", Icon: "lucide:Apple", Tint: "danger", Sort: 20},
	{ID: "life", Domain: model.UserCategoryDomainHabit, Name: "生活", Emoji: "🏠", Icon: "lucide:Home", Tint: "success", Sort: 30},
	{ID: "study", Domain: model.UserCategoryDomainHabit, Name: "学习", Emoji: "📚", Icon: "lucide:BookOpen", Tint: "accent", Sort: 40},
	// ==================== 一级：待办域（6） id 即旧 tasks.category_id 存量值 ====================
	{ID: "c_work", Domain: model.UserCategoryDomainTask, Name: "工作", Emoji: "💼", Icon: "lucide:Briefcase", Tint: "primary", Sort: 10},
	{ID: "c_study", Domain: model.UserCategoryDomainTask, Name: "学习", Emoji: "📚", Icon: "lucide:BookOpen", Tint: "accent", Sort: 20},
	{ID: "c_life", Domain: model.UserCategoryDomainTask, Name: "生活", Emoji: "🏠", Icon: "lucide:Home", Tint: "success", Sort: 30},
	{ID: "c_health", Domain: model.UserCategoryDomainTask, Name: "健康", Emoji: "💪", Icon: "lucide:Dumbbell", Tint: "success", Sort: 40},
	{ID: "c_social", Domain: model.UserCategoryDomainTask, Name: "社交", Emoji: "👥", Icon: "lucide:Users", Tint: "accent", Sort: 50},
	{ID: "c_other", Domain: model.UserCategoryDomainTask, Name: "其他", Emoji: "📌", Icon: "lucide:Pin", Tint: "neutral", Sort: 60},

	// ==================== 二级：习惯域（18） ====================
	// 运动 sport
	{ID: "sport_01", Domain: model.UserCategoryDomainHabit, ParentID: "sport", Name: "跑步", Icon: "lucide:Footprints", Tint: "success", Sort: 10},
	{ID: "sport_02", Domain: model.UserCategoryDomainHabit, ParentID: "sport", Name: "骑行", Icon: "lucide:Bike", Tint: "success", Sort: 20},
	{ID: "sport_03", Domain: model.UserCategoryDomainHabit, ParentID: "sport", Name: "羽毛球", Icon: "lucide:Activity", Tint: "success", Sort: 30},
	{ID: "sport_04", Domain: model.UserCategoryDomainHabit, ParentID: "sport", Name: "健身", Icon: "lucide:Dumbbell", Tint: "success", Sort: 40},
	{ID: "sport_05", Domain: model.UserCategoryDomainHabit, ParentID: "sport", Name: "游泳", Icon: "lucide:Waves", Tint: "success", Sort: 50},
	// 饮食 diet
	{ID: "diet_01", Domain: model.UserCategoryDomainHabit, ParentID: "diet", Name: "早餐", Icon: "lucide:Coffee", Tint: "danger", Sort: 10},
	{ID: "diet_02", Domain: model.UserCategoryDomainHabit, ParentID: "diet", Name: "午餐", Icon: "lucide:Utensils", Tint: "danger", Sort: 20},
	{ID: "diet_03", Domain: model.UserCategoryDomainHabit, ParentID: "diet", Name: "晚餐", Icon: "lucide:Salad", Tint: "danger", Sort: 30},
	{ID: "diet_04", Domain: model.UserCategoryDomainHabit, ParentID: "diet", Name: "控糖", Icon: "lucide:CupSoda", Tint: "danger", Sort: 40},
	{ID: "diet_05", Domain: model.UserCategoryDomainHabit, ParentID: "diet", Name: "喝水", Icon: "lucide:Droplets", Tint: "danger", Sort: 50},
	// 生活 life
	{ID: "life_01", Domain: model.UserCategoryDomainHabit, ParentID: "life", Name: "早起", Icon: "lucide:Sunrise", Tint: "success", Sort: 10},
	{ID: "life_02", Domain: model.UserCategoryDomainHabit, ParentID: "life", Name: "早睡", Icon: "lucide:Moon", Tint: "success", Sort: 20},
	{ID: "life_03", Domain: model.UserCategoryDomainHabit, ParentID: "life", Name: "整理", Icon: "lucide:Sparkles", Tint: "success", Sort: 30},
	{ID: "life_04", Domain: model.UserCategoryDomainHabit, ParentID: "life", Name: "记账", Icon: "lucide:Wallet", Tint: "success", Sort: 40},
	// 学习 study
	{ID: "study_01", Domain: model.UserCategoryDomainHabit, ParentID: "study", Name: "阅读", Icon: "lucide:BookOpen", Tint: "accent", Sort: 10},
	{ID: "study_02", Domain: model.UserCategoryDomainHabit, ParentID: "study", Name: "背单词", Icon: "lucide:BookMarked", Tint: "accent", Sort: 20},
	{ID: "study_03", Domain: model.UserCategoryDomainHabit, ParentID: "study", Name: "课程", Icon: "lucide:Presentation", Tint: "accent", Sort: 30},
	{ID: "study_04", Domain: model.UserCategoryDomainHabit, ParentID: "study", Name: "复盘", Icon: "lucide:ClipboardCheck", Tint: "accent", Sort: 40},

	// ==================== 二级：待办域（16；c_other 无二级，保持平铺） ====================
	// 工作 c_work
	{ID: "c_work_01", Domain: model.UserCategoryDomainTask, ParentID: "c_work", Name: "周报", Icon: "lucide:FileText", Tint: "primary", Sort: 10},
	{ID: "c_work_02", Domain: model.UserCategoryDomainTask, ParentID: "c_work", Name: "会议", Icon: "lucide:Users", Tint: "primary", Sort: 20},
	{ID: "c_work_03", Domain: model.UserCategoryDomainTask, ParentID: "c_work", Name: "汇报", Icon: "lucide:Presentation", Tint: "primary", Sort: 30},
	{ID: "c_work_04", Domain: model.UserCategoryDomainTask, ParentID: "c_work", Name: "对接", Icon: "lucide:Send", Tint: "primary", Sort: 40},
	// 学习 c_study
	{ID: "c_study_01", Domain: model.UserCategoryDomainTask, ParentID: "c_study", Name: "课程", Icon: "lucide:Presentation", Tint: "accent", Sort: 10},
	{ID: "c_study_02", Domain: model.UserCategoryDomainTask, ParentID: "c_study", Name: "阅读", Icon: "lucide:BookOpen", Tint: "accent", Sort: 20},
	{ID: "c_study_03", Domain: model.UserCategoryDomainTask, ParentID: "c_study", Name: "练习", Icon: "lucide:PenLine", Tint: "accent", Sort: 30},
	// 生活 c_life
	{ID: "c_life_01", Domain: model.UserCategoryDomainTask, ParentID: "c_life", Name: "采购", Icon: "lucide:ShoppingCart", Tint: "success", Sort: 10},
	{ID: "c_life_02", Domain: model.UserCategoryDomainTask, ParentID: "c_life", Name: "家务", Icon: "lucide:Sparkles", Tint: "success", Sort: 20},
	{ID: "c_life_03", Domain: model.UserCategoryDomainTask, ParentID: "c_life", Name: "缴费", Icon: "lucide:Receipt", Tint: "success", Sort: 30},
	// 健康 c_health
	{ID: "c_health_01", Domain: model.UserCategoryDomainTask, ParentID: "c_health", Name: "就医", Icon: "lucide:Stethoscope", Tint: "success", Sort: 10},
	{ID: "c_health_02", Domain: model.UserCategoryDomainTask, ParentID: "c_health", Name: "运动", Icon: "lucide:Dumbbell", Tint: "success", Sort: 20},
	{ID: "c_health_03", Domain: model.UserCategoryDomainTask, ParentID: "c_health", Name: "体检", Icon: "lucide:HeartPulse", Tint: "success", Sort: 30},
	// 社交 c_social
	{ID: "c_social_01", Domain: model.UserCategoryDomainTask, ParentID: "c_social", Name: "聚会", Icon: "lucide:Users", Tint: "accent", Sort: 10},
	{ID: "c_social_02", Domain: model.UserCategoryDomainTask, ParentID: "c_social", Name: "联络", Icon: "lucide:PhoneCall", Tint: "accent", Sort: 20},
	{ID: "c_social_03", Domain: model.UserCategoryDomainTask, ParentID: "c_social", Name: "送礼", Icon: "lucide:Gift", Tint: "accent", Sort: 30},
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
//
// ⚠️ 顺序：先插一级（parent_id=''）再插二级，保证外键语义（本表无物理外键，
//    但 full_name 由「父名-子名」拼接，父必须先在其中，见下）。
func BuildUserCategories(userID, domain string) []model.UserCategory {
	now := time.Now()
	nameByID := make(map[string]string, len(userCategorySeeds))
	out := make([]model.UserCategory, 0, len(userCategorySeeds))
	// 先收集本 domain 的种子名（含一级），供二级拼 full_name
	for _, s := range userCategorySeeds {
		if s.Domain == domain {
			nameByID[s.ID] = s.Name
		}
	}
	for _, s := range userCategorySeeds {
		if s.Domain != domain {
			continue
		}
		// full_name：一级 = name；二级 = 「父名-子名」（父名查种子表，查不到则退化为 name）
		fullName := s.Name
		if s.ParentID != "" {
			if pn, ok := nameByID[s.ParentID]; ok {
				fullName = pn + "-" + s.Name
			}
		}
		out = append(out, model.UserCategory{
			ID:        s.ID,
			UserID:    userID,
			Domain:    s.Domain,
			ParentID:  s.ParentID,
			Name:      s.Name,
			FullName:  fullName,
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

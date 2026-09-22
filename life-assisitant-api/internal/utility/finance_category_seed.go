// Package utility 记账分类种子（内置分类清单的**唯一真源**）
//
// 来源：md/spec-20260921-v1/03-内置分类清单.md
// 共 20 个一级（12 支出 + 8 收入）+ 85 个二级 = 105 条 / 用户。
//
// ⚠️ 为什么不写进 SQL：
//  1. 分类是**用户级**的（每人一份），SQL 里写死 user_id 不可行；
//  2. 两端不重复维护 —— 前端从 GET /finance/categories 拉取；
//  3. 便于用固定 id 做「懒创建」的幂等播种（见 service/impl/finance_category.go）。
//
// ⚠️ 硬约束：
//  1. 现有 12 个分类（餐饮/交通/购物/娱乐/居住/医疗/学习/其他 + 工资/兼职/投资/其他）
//     的 **name 与 emoji 必须原样保留** —— 历史交易迁移靠 scope+name 匹配（02 §5.1），
//     改名会让历史数据映射不上、统计分裂；
//  2. 图标名必须是两端 ICON_GROUPS（constants/icon-groups.ts）里真实存在的 lucide 图标名 ——
//     icon 会落库，渲染时才不会失联；用户在选择器里也只能选到 ICON_GROUPS 内的名字；
//  3. 【260921 二轮】**内置的 85 个二级全部配上独立 icon**（03 §5.1 支出 61 + §5.2 收入 24）；
//     二级的 **tint / emoji 仍留空、继承父级**（老大只要求图标独立，颜色全独立会让 85 个色块打架）。
//
// id 规则（03 §6）：一级 fc_b_<key>；二级 <父id>_NN（NN 从 01 起）。
// 用户新建的分类（含二级）用 uuid 去横线（32 位），与 fc_b_ 前缀天然区分。
package utility

import (
	"fmt"
	"time"

	"github.com/life-assistant/api/internal/model"
)

const (
	// FinanceScopeExpense 支出
	FinanceScopeExpense = "expense"
	// FinanceScopeIncome 收入
	FinanceScopeIncome = "income"
)

// RootCategoryParent 一级分类的 parent_id。
//
// ⚠️ 必须是空串而不是 NULL：MySQL 唯一索引里 NULL 不参与比较，
// 若一级写 NULL，同一用户可有多个同名一级分类，唯一约束会静默失效（02 §1.2 坑 1）。
const RootCategoryParent = ""

// FinanceCategorySeedVersion 种子版本号（02 §4.3：后续新增内置项时，
// 用户当前版本 < 最新版本则只补新增项；本次不做具体增量）。
const FinanceCategorySeedVersion = 1

// FinanceCategorySeed 内置分类种子条目（一级与二级统一结构）
type FinanceCategorySeed struct {
	ID       string // 固定 id：一级 fc_b_xxx；二级 fc_b_xxx_NN
	ParentID string // 空串 = 一级
	Scope    string // expense / income
	Name     string // 显示名（不含父级前缀）
	FullName string // 一级 = Name；二级 = 「父-子」
	Emoji    string // 二级留空 = 继承父级
	Icon     string // 一级内置必填；二级内置已逐个配好（03 §5）；用户新建留空 = 继承父级
	Tint     string // 二级留空 = 继承父级
	Sort     int    // 越小越前；一级 10/20/30…，二级同样从 10 起
}

// financeCategoryChild 二级分类定义（name + 独立 icon；tint / emoji 仍继承父级）
type financeCategoryChild struct {
	Name string
	Icon string
}

// financeCategoryPrimary 一级分类定义（children 各自带 icon，其余字段继承父级）
type financeCategoryPrimary struct {
	ID       string
	Name     string
	Emoji    string
	Icon     string
	Tint     string
	Children []financeCategoryChild
}

// 支出一级（12 个，sort = 10, 20, … 120；见 03 §2、二级图标见 §5.1）
var financeCategoryExpensePrimaries = []financeCategoryPrimary{
	{ID: "fc_b_food", Name: "餐饮", Emoji: "🍱", Icon: "Utensils", Tint: "warning",
		Children: []financeCategoryChild{
			{Name: "三餐", Icon: "Utensils"},
			{Name: "零食", Icon: "Cookie"},
			{Name: "饮料奶茶", Icon: "CupSoda"},
			{Name: "外卖", Icon: "Package"},
			{Name: "聚餐", Icon: "UtensilsCrossed"},
			{Name: "烟酒", Icon: "Wine"},
		}},
	{ID: "fc_b_transit", Name: "交通", Emoji: "🚇", Icon: "Route", Tint: "primary",
		Children: []financeCategoryChild{
			{Name: "公交地铁", Icon: "Bus"},
			{Name: "打车", Icon: "CarFront"},
			{Name: "加油", Icon: "Fuel"},
			{Name: "停车", Icon: "ParkingCircle"},
			{Name: "火车高铁", Icon: "TrainFront"},
			{Name: "飞机", Icon: "Plane"},
			{Name: "共享单车", Icon: "Bike"},
		}},
	{ID: "fc_b_shopping", Name: "购物", Emoji: "🛍️", Icon: "ShoppingBag", Tint: "danger",
		Children: []financeCategoryChild{
			{Name: "日用品", Icon: "ShoppingBasket"},
			{Name: "服饰鞋包", Icon: "Shirt"},
			{Name: "数码电器", Icon: "Monitor"},
			{Name: "美妆护肤", Icon: "Brush"},
			{Name: "家居家装", Icon: "Sofa"},
			{Name: "快递运费", Icon: "Truck"},
		}},
	{ID: "fc_b_home", Name: "居住", Emoji: "🏠", Icon: "Home", Tint: "success",
		Children: []financeCategoryChild{
			{Name: "房租", Icon: "Key"},
			{Name: "房贷", Icon: "Landmark"},
			{Name: "水电费", Icon: "Droplet"},
			{Name: "燃气费", Icon: "Flame"},
			{Name: "物业费", Icon: "Home"},
			{Name: "网络话费", Icon: "Phone"},
			{Name: "维修", Icon: "PlugZap"},
			{Name: "家政", Icon: "Brush"},
		}},
	{ID: "fc_b_fun", Name: "娱乐", Emoji: "🎬", Icon: "Video", Tint: "accent",
		Children: []financeCategoryChild{
			{Name: "电影演出", Icon: "Film"},
			{Name: "游戏", Icon: "Gamepad2"},
			{Name: "旅游", Icon: "Palmtree"},
			{Name: "运动健身", Icon: "Dumbbell"},
			{Name: "会员订阅", Icon: "Crown"},
			{Name: "酒吧KTV", Icon: "Mic"},
		}},
	{ID: "fc_b_medical", Name: "医疗", Emoji: "💊", Icon: "HeartPulse", Tint: "warning",
		Children: []financeCategoryChild{
			{Name: "门诊挂号", Icon: "Stethoscope"},
			{Name: "药品", Icon: "Pill"},
			{Name: "体检", Icon: "Activity"},
			{Name: "牙科", Icon: "Cross"},
			{Name: "住院", Icon: "BedDouble"},
			{Name: "保险", Icon: "FileText"},
		}},
	{ID: "fc_b_study", Name: "学习", Emoji: "📚", Icon: "BookOpen", Tint: "primary",
		Children: []financeCategoryChild{
			{Name: "课程培训", Icon: "BookOpen"},
			{Name: "书籍", Icon: "Book"},
			{Name: "文具", Icon: "Pencil"},
			{Name: "考试报名", Icon: "GraduationCap"},
		}},
	{ID: "fc_b_social", Name: "人情", Emoji: "🎁", Icon: "Gift", Tint: "danger",
		Children: []financeCategoryChild{
			{Name: "红包", Icon: "Gift"},
			{Name: "送礼", Icon: "HeartHandshake"},
			{Name: "请客", Icon: "UtensilsCrossed"},
			{Name: "孝敬长辈", Icon: "Heart"},
		}},
	{ID: "fc_b_baby", Name: "育儿", Emoji: "🍼", Icon: "Baby", Tint: "accent",
		Children: []financeCategoryChild{
			{Name: "奶粉辅食", Icon: "Milk"},
			{Name: "玩具", Icon: "ToyBrick"},
			{Name: "童装", Icon: "Shirt"},
			{Name: "学费", Icon: "GraduationCap"},
			{Name: "医疗", Icon: "Stethoscope"},
		}},
	{ID: "fc_b_pet", Name: "宠物", Emoji: "🐾", Icon: "PawPrint", Tint: "success",
		Children: []financeCategoryChild{
			{Name: "主粮", Icon: "Beef"},
			{Name: "零食", Icon: "Cookie"},
			{Name: "医疗", Icon: "Stethoscope"},
			{Name: "用品", Icon: "Package"},
			{Name: "寄养", Icon: "Home"},
		}},
	{ID: "fc_b_finance", Name: "金融", Emoji: "💳", Icon: "Landmark", Tint: "primary",
		Children: []financeCategoryChild{
			{Name: "手续费", Icon: "Receipt"},
			{Name: "利息", Icon: "Percent"},
			{Name: "税费", Icon: "Landmark"},
			{Name: "罚款", Icon: "TrafficCone"},
		}},
	// 「其他」是兜底项，**内置不给二级**（03 §8）
	{ID: "fc_b_other_e", Name: "其他", Emoji: "📦", Icon: "Package", Tint: "neutral"},
}

// 收入一级（8 个，sort = 10, 20, … 80；见 03 §3、二级图标见 §5.2）
var financeCategoryIncomePrimaries = []financeCategoryPrimary{
	{ID: "fc_b_salary", Name: "工资", Emoji: "💰", Icon: "Banknote", Tint: "success",
		Children: []financeCategoryChild{
			{Name: "月薪", Icon: "Banknote"},
			{Name: "加班费", Icon: "Clock"},
			{Name: "年终奖", Icon: "Trophy"},
			{Name: "绩效奖金", Icon: "Target"},
		}},
	{ID: "fc_b_part", Name: "兼职", Emoji: "💼", Icon: "Briefcase", Tint: "primary",
		Children: []financeCategoryChild{
			{Name: "外包", Icon: "Briefcase"},
			{Name: "副业", Icon: "Laptop"},
			{Name: "稿费", Icon: "PenLine"},
			{Name: "直播打赏", Icon: "Video"},
		}},
	{ID: "fc_b_invest", Name: "投资", Emoji: "📈", Icon: "TrendingUp", Tint: "accent",
		Children: []financeCategoryChild{
			{Name: "股票", Icon: "TrendingUp"},
			{Name: "基金", Icon: "PieChart"},
			{Name: "利息", Icon: "Percent"},
			{Name: "分红", Icon: "Coins"},
			{Name: "房租收入", Icon: "Key"},
		}},
	{ID: "fc_b_reimburse", Name: "报销", Emoji: "🧾", Icon: "Receipt", Tint: "warning",
		Children: []financeCategoryChild{
			{Name: "差旅", Icon: "Plane"},
			{Name: "办公", Icon: "Briefcase"},
			{Name: "医疗", Icon: "Stethoscope"},
		}},
	{ID: "fc_b_social_in", Name: "人情", Emoji: "🎁", Icon: "Gift", Tint: "danger",
		Children: []financeCategoryChild{
			{Name: "红包", Icon: "Gift"},
			{Name: "礼金", Icon: "HeartHandshake"},
			{Name: "压岁钱", Icon: "PartyPopper"},
		}},
	{ID: "fc_b_refund", Name: "退款", Emoji: "↩️", Icon: "RotateCcw", Tint: "neutral",
		Children: []financeCategoryChild{
			{Name: "购物退款", Icon: "RotateCcw"},
			{Name: "退税", Icon: "Receipt"},
		}},
	{ID: "fc_b_subsidy", Name: "补贴", Emoji: "🏛️", Icon: "Landmark", Tint: "primary",
		Children: []financeCategoryChild{
			{Name: "公积金", Icon: "Landmark"},
			{Name: "失业金", Icon: "Banknote"},
			{Name: "生育津贴", Icon: "Baby"},
		}},
	{ID: "fc_b_other_i", Name: "其他", Emoji: "💵", Icon: "Banknote", Tint: "neutral"},
}

// financeCategorySeeds 展开后的一级 + 二级全量种子（顺序：支出全部 → 收入全部）
var financeCategorySeeds = func() []FinanceCategorySeed {
	out := make([]FinanceCategorySeed, 0, 105)
	appendAll := func(scope string, primaries []financeCategoryPrimary) {
		for i, p := range primaries {
			out = append(out, FinanceCategorySeed{
				ID:       p.ID,
				ParentID: RootCategoryParent,
				Scope:    scope,
				Name:     p.Name,
				FullName: p.Name,
				Emoji:    p.Emoji,
				Icon:     p.Icon,
				Tint:     p.Tint,
				Sort:     (i + 1) * 10,
			})
			for j, child := range p.Children {
				out = append(out, FinanceCategorySeed{
					ID:       fmt.Sprintf("%s_%02d", p.ID, j+1),
					ParentID: p.ID,
					Scope:    scope,
					Name:     child.Name,
					FullName: p.Name + "-" + child.Name,
					// 二轮：内置二级逐个配好 icon（03 §5）；tint / emoji 仍留空继承父级
					Icon: child.Icon,
					Sort: (j + 1) * 10,
				})
			}
		}
	}
	appendAll(FinanceScopeExpense, financeCategoryExpensePrimaries)
	appendAll(FinanceScopeIncome, financeCategoryIncomePrimaries)
	return out
}()

// FinanceCategorySeeds 返回内置分类种子的副本（调用方可安全修改，不污染全局表）
func FinanceCategorySeeds() []FinanceCategorySeed {
	out := make([]FinanceCategorySeed, len(financeCategorySeeds))
	copy(out, financeCategorySeeds)
	return out
}

// BuildSeedCategories 把种子常量展开为「某个具体用户」的分类实体切片（每人一份）。
//
// 服务端的懒播种（service/impl/finance_category.go）与一次性播种脚本（scripts/fincatseed）
// 共用本函数，保证两份代码产出的行完全一致。活跃行 deleted_seq 为空串（默认），
// 由唯一索引前几列保唯一；种子全部 is_builtin=true。
func BuildSeedCategories(userID string) []model.FinanceCategory {
	seeds := FinanceCategorySeeds()
	now := time.Now()
	out := make([]model.FinanceCategory, 0, len(seeds))
	for _, s := range seeds {
		c := model.FinanceCategory{
			ID:        s.ID,
			UserID:    userID,
			ParentID:  s.ParentID,
			Scope:     s.Scope,
			Name:      s.Name,
			Sort:      s.Sort,
			IsBuiltin: true,
			CreatedAt: now,
			UpdatedAt: now,
		}
		full := s.FullName
		c.FullName = &full
		if s.Emoji != "" {
			v := s.Emoji
			c.Emoji = &v
		}
		if s.Icon != "" {
			v := s.Icon
			c.Icon = &v
		}
		if s.Tint != "" {
			v := s.Tint
			c.Tint = &v
		}
		out = append(out, c)
	}
	return out
}

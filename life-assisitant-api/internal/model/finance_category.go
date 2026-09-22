// Package model 收支分类实体（finance_categories）
//
// 定位：记账模块的两级分类，**用户级**（每人一份，内置种子懒创建，见 02 §4）。
// 一级与二级同表，用 parent_id 表达层级：
//
//	parent_id = ''  → 一级分类（如「餐饮」）
//	parent_id = 一级 id → 二级分类（如「餐饮-三餐」）
//
// ⚠️ 两个必须避开的 SQL 坑（02 §1.2 / 02 §1 改版）：
//
//	坑 1：parent_id 不能用 NULL，要用空串 —— MySQL 唯一索引里 NULL 不参与比较，
//	      一级写 NULL 会让「同一用户多个同名一级」静默通过约束。见 utility.RootCategoryParent。
//	坑 2（改版）：唯一索引当初用 is_deleted(tinyint) 当末列来「容错重名」，
//	      但「同名分类 → 删除 → 重建 → 再删除」会让第二行 (…, name, is_deleted=1)
//	      撞 uk 报 1062。现改为：uk 末列用 deleted_seq（每删一次写入**该行自身 id**，
//	      全库唯一）→ 删一百次同名也不会撞；活跃行的 deleted_seq 永远为 ''（由前面几列保唯一）。
//	      软删除时仍要 is_deleted=1 + deleted_at=NOW() **两个一起写**（deleted_at 为 NULL 的
//	      活跃行不受 is_deleted 约束，这是 audit 需要，与 uk 已无关）。
//
// ⚠️ 索引 tag 必须**显式写索引名**且与 db/data_260921_finance_categories.sql 的 DDL 逐字一致：
// 裸写会让 AutoMigrate 误删库里已有的单列唯一索引 → Error 1553（API 起不来）或静默丢约束
// （period_settings 已踩过一次；见 02 §1.2 的项目铁律）。
//
// ⚠️ deleted_at 刻意**不用 gorm.DeletedAt**：
// 判断「是否已播种」需要**连已删除行一起查**（02 §4.2），gorm.DeletedAt 会自动过滤掉它们。
// 因此这里用普通 *time.Time，软删/过滤全部显式手写。
//
// ⚠️⚠️ **主键是复合主键 `(id, user_id)`，不是 02 §1 DDL 里写的 `PRIMARY KEY (id)`** ——
// 这是实现阶段发现的**文档自相矛盾**，必须修正，否则第 2 个用户会拿不到任何内置分类：
//
//	· 02 §4.1 / README D4 / 03 §7 明确：分类是**用户级**，「每人一份」，105 条 × 用户数；
//	· 03 §6 明确：内置项用**固定 id**（一级 fc_b_food、二级 fc_b_food_01），全用户相同；
//	· 02 §1 DDL 却写 `PRIMARY KEY (id)` —— 那么第二个用户播种时，全部内置行都会
//	  撞主键 → `INSERT IGNORE` 静默丢弃 → 该用户分类列表为空（且 seeded 返回 true）。
//
// ⇒ 改为复合主键 `(id, user_id)`：既保留文档要求的固定 id（06 接口示例、02 §5.1 回填映射都成立），
// 又保证「每人一份」。代价：`id` 单独不再全局唯一，**任何按 id 的查询都必须带 user_id**（本 DAO 已全部带上）。
package model

import "time"

// FinanceCategory 收支分类实体
type FinanceCategory struct {
	ID string `gorm:"column:id;primaryKey;type:varchar(32)" json:"id"`
	// UserID 复合主键第 2 列，同时参与 uk（唯一索引第 1 列）与 idx_fin_cat_user_scope（第 1 列）
	UserID string `gorm:"column:user_id;type:varchar(32);not null;primaryKey;index:idx_fin_cat_user_scope,priority:1;uniqueIndex:uk_fin_cat_user_scope_parent_name,priority:1" json:"user_id"`
	// ParentID 父分类 id；空串 = 一级（见 utility.RootCategoryParent）
	ParentID string `gorm:"column:parent_id;type:varchar(32);not null;default:'';index:idx_fin_cat_parent;uniqueIndex:uk_fin_cat_user_scope_parent_name,priority:3" json:"parent_id"`
	// Scope expense / income，见下方 Scope* 常量
	Scope string `gorm:"column:scope;type:varchar(10);not null;default:'expense';index:idx_fin_cat_user_scope,priority:2;uniqueIndex:uk_fin_cat_user_scope_parent_name,priority:2" json:"scope"`
	// Name 显示名（不含父级前缀），如「三餐」
	Name string `gorm:"column:name;type:varchar(30);not null;uniqueIndex:uk_fin_cat_user_scope_parent_name,priority:4" json:"name"`
	// FullName 完整名（「餐饮-三餐」）；交易快照与搜索都用它
	FullName *string `gorm:"column:full_name;type:varchar(80)" json:"full_name,omitempty"`
	// Emoji 可选 emoji（兼容旧渲染 / 导出）；二级留空 = 继承父级
	Emoji *string `gorm:"column:emoji;type:varchar(20)" json:"emoji,omitempty"`
	// Icon Lucide 图标名（PascalCase），如 Utensils；二级留空 = 继承父级
	Icon *string `gorm:"column:icon;type:varchar(40)" json:"icon,omitempty"`
	// Tint 语义色名，取自前端 utils/tint 的 TintName；二级留空 = 继承父级
	Tint *string `gorm:"column:tint;type:varchar(20)" json:"tint,omitempty"`
	// Sort 排序，越小越前；内置项 10/20/30…，用户新建从 900 起
	Sort int `gorm:"column:sort;not null;default:0" json:"sort"`
	// IsBuiltin 是否内置种子（供「恢复默认」与「是否已播种」判断）
	IsBuiltin bool `gorm:"column:is_builtin;type:tinyint(1);not null;default:0" json:"is_builtin"`
	// IsDeleted 软删除标记（audit 用；**不再参与唯一索引**，uk 末列已改为 deleted_seq）
	IsDeleted bool `gorm:"column:is_deleted;type:tinyint(1);not null;default:0" json:"is_deleted"`
	// DeletedSeq 软删序号：活跃行恒为 ''；删除时写入**该行自身 id**（全库唯一），
	// 作为唯一索引 uk_fin_cat_user_scope_parent_name 的末列，避免「同名分类反复删除」撞 1062。
	// 见 02 §1 改版说明。
	DeletedSeq string `gorm:"column:deleted_seq;type:varchar(32);not null;default:'';uniqueIndex:uk_fin_cat_user_scope_parent_name,priority:5" json:"deleted_seq"`

	CreatedAt time.Time  `gorm:"column:created_at;autoCreateTime" json:"created_at"`
	UpdatedAt time.Time  `gorm:"column:updated_at;autoUpdateTime" json:"updated_at"`
	DeletedAt *time.Time `gorm:"column:deleted_at" json:"deleted_at,omitempty"`
}

// TableName 显式指定表名
func (c *FinanceCategory) TableName() string { return "finance_categories" }

// Scope 取值（与 utility.FinanceScopeExpense / FinanceScopeIncome 一致）
const (
	FinanceCategoryScopeExpense = "expense"
	FinanceCategoryScopeIncome  = "income"
)

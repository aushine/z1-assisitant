// Package model 习惯 / 待办分类实体（user_categories，两域共用一张表）
//
// 定位：习惯（domain=habit）与待办（domain=task）的分类，**用户级**
// （每人一份，内置种子懒创建，判定口径见 dao.UserCategory.ExistsBuiltin）。
//
// ⚠️ 三条必须照抄的铁律（06 §3.1）：
//  1. **复合主键 (id, user_id)** —— 内置 id 跨用户重复（`sport` 每人都有），单主键必撞；
//     因此任何按 id 的查询都必须带 user_id。
//  2. **唯一索引 uk_user_cat 末列用 deleted_seq（不是 deleted_at）** ——
//     活跃行 deleted_at 为 NULL，NULL 不参与唯一比较 ⇒ 用 deleted_at 约束会静默失效；
//     且「同名分类 → 删除 → 重建 → 再删除」会撞 1062，deleted_seq 每次写随机值即可避免。
//  3. 判断「是否需要播种」= 是否存在 is_builtin=1 的行（**含已删除行**），
//     不是「当前分类数为 0」—— 否则用户删光后又被塞满。
//
// ⚠️ 索引 tag 必须**显式写索引名**且与 manifest/sql/0001_init.sql 的 DDL 逐字一致：
// 裸写会让 AutoMigrate 误删库里已有的索引 → Error 1553 或静默丢唯一约束（项目铁律）。
//
// ⚠️ deleted_at 刻意**不用 gorm.DeletedAt**：ExistsBuiltin 需要连已删除行一起查，
// gorm.DeletedAt 会自动过滤掉它们。软删/过滤全部显式手写。
//
// ⚠️ id 保留旧值 ⇒ 零迁移：habit 内置直接用存量四键 sport/diet/life/study，
// task 内置直接用 c_work…c_other（06 §3.2）；新建分类 id 规则 uc_<domain>_<10位随机>。
package model

import "time"

// UserCategory 习惯/待办分类实体
type UserCategory struct {
	ID string `gorm:"column:id;primaryKey;type:varchar(32)" json:"id"`
	// UserID 复合主键第 2 列，同时参与 uk_user_cat（第 1 列）与 idx_user_cat_domain（第 1 列）
	UserID string `gorm:"column:user_id;type:varchar(32);not null;primaryKey;index:idx_user_cat_domain,priority:1;uniqueIndex:uk_user_cat,priority:1" json:"user_id"`
	// Domain habit / task，见下方 UserCategoryDomain* 常量
	Domain string `gorm:"column:domain;type:varchar(16);not null;index:idx_user_cat_domain,priority:2;uniqueIndex:uk_user_cat,priority:2" json:"domain"`
	// Name 显示名（去空白后 1-10 字）
	Name string `gorm:"column:name;type:varchar(30);not null;uniqueIndex:uk_user_cat,priority:3" json:"name"`
	// Emoji 可选 emoji（兼容旧渲染）；空 = 无
	Emoji string `gorm:"column:emoji;type:varchar(20);not null;default:''" json:"emoji"`
	// Icon 图标引用，落库为 `lucide:<Name>` 形式（如 lucide:BookOpen，最长 29 字符 ⇒ 列 40）；空 = 无
	Icon string `gorm:"column:icon;type:varchar(40);not null;default:'';comment:lucide:Pin" json:"icon"`
	// Tint 语义色名（primary/success/accent/danger/warning/neutral）
	Tint string `gorm:"column:tint;type:varchar(20);not null;default:'neutral'" json:"tint"`
	// Sort 排序，越小越前；内置项 10/20/30…，用户新建从 900 起
	Sort int `gorm:"column:sort;type:int;not null;default:0" json:"sort"`
	// IsBuiltin 是否内置种子（供「是否已播种」判断，含已删除行）
	IsBuiltin bool `gorm:"column:is_builtin;type:tinyint(1);not null;default:0" json:"is_builtin"`
	// IsDeleted 软删除标记（audit 用）
	IsDeleted bool `gorm:"column:is_deleted;type:tinyint(1);not null;default:0" json:"is_deleted"`
	// DeletedSeq 软删序号：活跃行恒为 ''；删除时写入随机值，
	// 作为唯一索引 uk_user_cat 的末列，避免「同名分类反复删除」撞 1062。
	DeletedSeq string `gorm:"column:deleted_seq;type:varchar(32);not null;default:'';uniqueIndex:uk_user_cat,priority:4" json:"deleted_seq"`

	CreatedAt time.Time  `gorm:"column:created_at;autoCreateTime" json:"created_at"`
	UpdatedAt time.Time  `gorm:"column:updated_at;autoUpdateTime" json:"updated_at"`
	DeletedAt *time.Time `gorm:"column:deleted_at" json:"deleted_at,omitempty"`
}

// TableName 显式指定表名
func (c *UserCategory) TableName() string { return "user_categories" }

// ====== domain 取值（与前端 utils/category-dict 的两域一致） ======
const (
	// UserCategoryDomainHabit 习惯分类域（内置 sport/diet/life/study）
	UserCategoryDomainHabit = "habit"
	// UserCategoryDomainTask 待办分类域（内置 c_work/c_study/c_life/c_health/c_social/c_other）
	UserCategoryDomainTask = "task"
)

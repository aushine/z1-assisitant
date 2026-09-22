// Package model 交易实体
package model

import (
	"time"

	"gorm.io/gorm"
)

// Transaction 交易表实体
// MVP 字段集：id / user_id / type / amount / category_emoji / category_name /
//   account_id / account_name / to_account_id / to_account_name / note / happened_at / created_at / updated_at / deleted_at
// type: expense（支出）/ income（收入）/ transfer（转账）
// 转账时：amount 始终为正数，account_id=出账，to_account_id=入账
// 金额：float64，DB 列 DECIMAL(18,2)，损失精度可接受
// 冗余字段：account_name / to_account_name — 删除账户后不再通过 ID 关联查询，直接显示冗余账户名
// 不做：attachments / location / version
type Transaction struct {
	ID            string         `gorm:"column:id;primaryKey;type:varchar(32)"           json:"id"`
	UserID        string         `gorm:"column:user_id;type:varchar(32);not null;index:idx_user_type,priority:1" json:"user_id"`
	Type          string         `gorm:"column:type;type:varchar(20);not null;index:idx_user_type,priority:2" json:"type"`
	Amount        float64        `gorm:"column:amount;type:decimal(18,2);not null"        json:"amount"`
	CategoryEmoji *string        `gorm:"column:category_emoji;type:varchar(20)"          json:"category_emoji,omitempty"`
	CategoryName  *string        `gorm:"column:category_name;type:varchar(50)"           json:"category_name,omitempty"`
	// CategoryID 分类 id（权威，指向 finance_categories.id）；NULL = 历史数据未映射。
	// ⚠️ 索引名显式写全名，与手写 DDL 逐字一致（02 §1.2 铁律）。
	// category_name 保留为**写入快照**（分类被删后仍能显示），category_emoji 停止写新值但保留列。
	CategoryID *string `gorm:"column:category_id;type:varchar(32);index:idx_tx_category" json:"category_id,omitempty"`
	AccountID     string         `gorm:"column:account_id;type:varchar(32);not null;index"  json:"account_id"`
	AccountName   *string        `gorm:"column:account_name;type:varchar(50)"            json:"account_name,omitempty"`
	ToAccountID   *string        `gorm:"column:to_account_id;type:varchar(32);index"     json:"to_account_id,omitempty"`
	ToAccountName *string        `gorm:"column:to_account_name;type:varchar(50)"         json:"to_account_name,omitempty"`
	Note          *string        `gorm:"column:note;type:varchar(500)"                   json:"note,omitempty"`
	ReversedBy    *string        `gorm:"column:reversed_by;type:varchar(32);index"       json:"reversed_by,omitempty"`

	// 计入口径 / 来源 / 关联（260921 v2 + v4）
	// ⚠️ 这 5 列**不加 index**（本项目有过"裸写索引名误删唯一索引 → Error 1553"的事故；默认值选择性差，加了只拖写入）
	ExcludeBudget bool   `json:"exclude_budget" gorm:"column:exclude_budget;type:tinyint(1);not null;default:0"`
	ExcludeStats  bool   `json:"exclude_stats"  gorm:"column:exclude_stats;type:tinyint(1);not null;default:0"`
	Source        string `json:"source"         gorm:"column:source;type:varchar(20);not null;default:''"`
	Contact       string `json:"contact"        gorm:"column:contact;type:varchar(50);not null;default:''"`
	SettleOf      string `json:"settle_of"      gorm:"column:settle_of;type:varchar(32);not null;default:''"`

	HappenedAt    time.Time      `gorm:"column:happened_at;not null;index:idx_user_happened,priority:2" json:"happened_at"`
	CreatedAt     time.Time      `gorm:"column:created_at;autoCreateTime"                json:"created_at"`
	UpdatedAt     time.Time      `gorm:"column:updated_at;autoUpdateTime"                json:"updated_at"`
	DeletedAt     gorm.DeletedAt `gorm:"column:deleted_at;index"                         json:"deleted_at,omitempty"`
}

// TableName 显式指定表名
func (t *Transaction) TableName() string { return "transactions" }

// ====== 交易类型枚举 ======
const (
	TransactionTypeExpense  = "expense"
	TransactionTypeIncome   = "income"
	TransactionTypeTransfer = "transfer"
)

// 交易来源（source）。空串 = 普通记账。
// balance_adjust 是**系统内部来源**（余额调整），不允许前端伪造（CreateTransaction 会拒）。
const (
	TxSourceReimburse  = "reimburse" // 待报销
	TxSourceLend       = "lend"      // 借出
	TxSourceBorrow     = "borrow"    // 借入
	TxSourceRefund     = "refund"    // 退款
	TxSourceBalanceAdj = "balance_adjust"
)

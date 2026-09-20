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
	AccountID     string         `gorm:"column:account_id;type:varchar(32);not null;index"  json:"account_id"`
	AccountName   *string        `gorm:"column:account_name;type:varchar(50)"            json:"account_name,omitempty"`
	ToAccountID   *string        `gorm:"column:to_account_id;type:varchar(32);index"     json:"to_account_id,omitempty"`
	ToAccountName *string        `gorm:"column:to_account_name;type:varchar(50)"         json:"to_account_name,omitempty"`
	Note          *string        `gorm:"column:note;type:varchar(500)"                   json:"note,omitempty"`
	ReversedBy    *string        `gorm:"column:reversed_by;type:varchar(32);index"       json:"reversed_by,omitempty"`
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

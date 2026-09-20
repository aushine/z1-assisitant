// Package dto 记账模块 DTO
package dto

// ====== 账户 ======

// CreateAccountReq 创建账户
type CreateAccountReq struct {
	Name    string  `json:"name"     dc:"账户名，1-50 字符"`
	Type    string  `json:"type"     dc:"账户类型：saving/credit/huabei/wechat"`
	Icon    string  `json:"icon"     dc:"emoji 图标"`
	Color   string  `json:"color"    dc:"图标底色 hex"`
	Balance float64 `json:"balance"  dc:"初始余额（默认 0，单位元）"`
}

// UpdateAccountReq 更新账户
type UpdateAccountReq struct {
	Name    *string  `json:"name"     dc:"账户名"`
	Icon    *string  `json:"icon"     dc:"emoji 图标"`
	Color   *string  `json:"color"    dc:"图标底色 hex"`
	Balance *float64 `json:"balance"  dc:"余额（直接覆盖）"`
}

// AccountResp 账户响应
type AccountResp struct {
	ID        string  `json:"id"`
	Name      string  `json:"name"`
	Type      string  `json:"type"`
	Icon      string  `json:"icon"`
	Color     string  `json:"color"`
	Balance   float64 `json:"balance"`
	CreatedAt string  `json:"created_at"`
	UpdatedAt string  `json:"updated_at"`
}

// ListAccountsResp 账户列表响应
type ListAccountsResp struct {
	Items        []AccountResp `json:"items"`
	TotalBalance float64       `json:"total_balance"`
	Total        int           `json:"total"`
}

// TotalBalanceResp 净资产响应
type TotalBalanceResp struct {
	TotalBalance float64 `json:"total_balance"`
}

// ====== 交易 ======

// CreateTransactionReq 创建交易
type CreateTransactionReq struct {
	Type          string  `json:"type"           dc:"类型：expense/income（transfer 走独立接口）"`
	Amount        float64 `json:"amount"         dc:"金额（正数，单位元）"`
	CategoryEmoji string  `json:"category_emoji" dc:"分类 emoji"`
	CategoryName  string  `json:"category_name"  dc:"分类名"`
	AccountID     string  `json:"account_id"     dc:"出/入账账户 ID"`
	HappenedAt    string  `json:"happened_at"    dc:"发生时间 ISO8601（默认 now）"`
	Note          string  `json:"note"           dc:"备注"`
}

// UpdateTransactionReq 更新交易（仅 expense / income）
type UpdateTransactionReq struct {
	Amount        *float64 `json:"amount"         dc:"金额（正数）"`
	CategoryEmoji *string  `json:"category_emoji" dc:"分类 emoji"`
	CategoryName  *string  `json:"category_name"  dc:"分类名"`
	AccountID     *string  `json:"account_id"     dc:"账户 ID"`
	HappenedAt    *string  `json:"happened_at"    dc:"发生时间 ISO8601"`
	Note          *string  `json:"note"           dc:"备注"`
}

// TransferReq 转账请求
type TransferReq struct {
	FromAccountID string  `json:"from_account_id" dc:"转出账户 ID"`
	ToAccountID   string  `json:"to_account_id"   dc:"转入账户 ID"`
	Amount        float64 `json:"amount"          dc:"金额（正数，单位元）"`
	HappenedAt    string  `json:"happened_at"     dc:"发生时间 ISO8601（默认 now）"`
	Note          string  `json:"note"            dc:"备注"`
}

// TransactionResp 交易响应
type TransactionResp struct {
	ID             string  `json:"id"`
	Type           string  `json:"type"`
	Amount         float64 `json:"amount"`
	CategoryEmoji  string  `json:"category_emoji,omitempty"`
	CategoryName   string  `json:"category_name,omitempty"`
	AccountID      string  `json:"account_id"`
	AccountName    string  `json:"account_name,omitempty"`
	ToAccountID    string  `json:"to_account_id,omitempty"`
	ToAccountName  string  `json:"to_account_name,omitempty"`
	Note           string  `json:"note,omitempty"`
	HappenedAt     string  `json:"happened_at"`
	CreatedAt      string  `json:"created_at"`
}

// ReverseTransactionResp 冲正交易响应
type ReverseTransactionResp struct {
	OriginalTransaction TransactionResp `json:"original_transaction"`
	ReverseTransaction  TransactionResp `json:"reverse_transaction"`
}

// ListTransactionsResp 交易列表响应
type ListTransactionsResp struct {
	Items []TransactionResp `json:"items"`
	Total int64             `json:"total"`
}

// ListTransactionsReq 交易列表查询参数
type ListTransactionsReq struct {
	Type      string `json:"type"       dc:"按类型筛选"`
	AccountID string `json:"account_id" dc:"按账户筛选"`
	Keyword   string `json:"keyword"    dc:"按备注/分类名模糊搜索"`
	StartDate string `json:"start_date" dc:"开始日期 YYYY-MM-DD"`
	EndDate   string `json:"end_date"   dc:"结束日期 YYYY-MM-DD"`
	Page      int    `json:"page"       dc:"页码"`
	PageSize  int    `json:"page_size"  dc:"每页条数"`
}

// ====== 预算 ======

// CreateBudgetReq 创建预算
type CreateBudgetReq struct {
	Name           string  `json:"name"            dc:"预算名称，如7月总预算"`
	Period         string  `json:"period"          dc:"周期：monthly/weekly/yearly"`
	Amount         float64 `json:"amount"          dc:"预算总额（正数，单位元）"`
	Scope          string  `json:"scope"           dc:"范围：total/category（默认 total）"`
	CategoryEmoji  string  `json:"category_emoji"  dc:"分类 emoji（scope=category 时必填）"`
	CategoryName   string  `json:"category_name"   dc:"分类名称（scope=category 时必填）"`
	StartDate      string  `json:"start_date"      dc:"起始日期 YYYY-MM-DD"`
	EndDate        string  `json:"end_date"        dc:"结束日期 YYYY-MM-DD"`
	AlertThreshold float64 `json:"alert_threshold" dc:"预警阈值 0-1，默认0.80"`
}

// UpdateBudgetReq 更新预算
type UpdateBudgetReq struct {
	Name           *string  `json:"name"            dc:"预算名称"`
	Amount         *float64 `json:"amount"          dc:"预算总额"`
	StartDate      *string  `json:"start_date"      dc:"起始日期 YYYY-MM-DD"`
	EndDate        *string  `json:"end_date"        dc:"结束日期 YYYY-MM-DD"`
	AlertThreshold *float64 `json:"alert_threshold" dc:"预警阈值"`
}

// BudgetResp 预算响应
type BudgetResp struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	Period         string  `json:"period"`
	Amount         float64 `json:"amount"`
	Used           float64 `json:"used"`
	Scope          string  `json:"scope"`
	CategoryEmoji  string  `json:"category_emoji,omitempty"`
	CategoryName   string  `json:"category_name,omitempty"`
	StartDate      string  `json:"start_date"`
	EndDate        string  `json:"end_date"`
	AlertThreshold float64 `json:"alert_threshold"`
	IsAlerted      bool    `json:"is_alerted"`
	CreatedAt      string  `json:"created_at"`
}

// ListBudgetsReq 预算列表查询参数
type ListBudgetsReq struct {
	Scope string `json:"scope" dc:"按范围筛选：total/category"`
}

// ListBudgetsResp 预算列表响应
type ListBudgetsResp struct {
	Items []BudgetResp `json:"items"`
}

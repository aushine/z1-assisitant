// Package dto 记账模块 DTO
package dto

// ====== 账户 ======

// CreateAccountReq 创建账户
type CreateAccountReq struct {
	Name        string  `json:"name"        dc:"账户名，1-50 字符"`
	Type        string  `json:"type"        dc:"账户类型（18 枚举白名单，见 utility/account_vocab.go；非法 → 400001）"`
	Institution string  `json:"institution" dc:"银行 code（CCB/ICBC），空=未指定；只校验长度 ≤20，不校验白名单（D20）"`
	Icon        string  `json:"icon"        dc:"图标引用：brand:<slug> | lucide:<Name> | <emoji>"`
	Color       string  `json:"color"       dc:"图标底色 hex"`
	Balance     float64 `json:"balance"     dc:"初始余额（默认 0，单位元；信用类存负数 = 欠款，D14）"`
}

// UpdateAccountReq 更新账户
type UpdateAccountReq struct {
	Name        *string  `json:"name"        dc:"账户名"`
	Icon        *string  `json:"icon"        dc:"图标引用：brand:<slug> | lucide:<Name> | <emoji>"`
	Color       *string  `json:"color"       dc:"图标底色 hex"`
	Balance     *float64 `json:"balance"     dc:"余额（直接覆盖）"`
	Institution *string  `json:"institution" dc:"银行 code（可改；空串=清空）；只校验长度 ≤20（D20）"`
	Type        *string  `json:"type"        dc:"账户类型（可改，Q5；可选字段缺省=不改；跨 L1 余额符号调整是前端职责，后端只存）"`

	// RecordFlow 是否在改余额时生成一笔流水。
	//
	// ⚠️ 只有显式传 true 才生成；nil 与 false 效果完全相同（都不生成）。
	//
	// 为什么这样设计（不要"优化"成 nil = 默认 true）：
	//   产品要求「默认记录、勾选不记录」，但后端必须向后兼容 ——
	//   未升级的老前端调 PATCH /accounts/:id 时只传 balance，
	//   若 nil 被当作"默认记录"，用户升级后端后会凭空多出一笔支出。
	//   ⇒ 由**新前端显式传 true** 来表达"默认记录"。
	//   ⚠️ 不要把 nil 优化成默认 true。
	RecordFlow *bool `json:"record_flow"`
}

// AccountResp 账户响应
type AccountResp struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Type        string  `json:"type"`
	Institution string  `json:"institution"`
	Icon        string  `json:"icon"`
	Color       string  `json:"color"`
	Balance     float64 `json:"balance"`
	CreatedAt   string  `json:"created_at"`
	UpdatedAt   string  `json:"updated_at"`
}

// ListAccountsResp 账户列表响应
type ListAccountsResp struct {
	Items        []AccountResp `json:"items"`
	TotalBalance float64       `json:"total_balance"`
	Total        int           `json:"total"`
	// ===== spec-20260922-v1 Phase 4：与 TotalBalanceResp 同源的大类归并字段（加字段不删字段）=====
	// ListAccounts 在同一循环内按 L1 归并（不额外查询）；net_worth ≡ assets+investments+debts ≡ total_balance（恒等）
	Assets      float64 `json:"assets"`      // 资金组小计（负值原样，透支是事实）
	Investments float64 `json:"investments"` // 理财组小计
	Debts       float64 `json:"debts"`       // 信用组小计（⚠️ 保留负数原值，前端取绝对值 + 「负债」标签）
	NetWorth    float64 `json:"net_worth"`   // = assets + investments + debts
}

// TotalBalanceResp 净资产响应
//
// ⚠️ 加字段不删字段（spec-20260922-v1 D25）：total_balance 为老字段（老前端消费），
//
//	语义冻结 = SUM(全部 balance)；符号迁移（D23）后其数值会变 —— 这是修 bug 的必然结果。
type TotalBalanceResp struct {
	TotalBalance float64 `json:"total_balance"` // 旧字段 = SUM(全部 balance) = 净资产（语义冻结）
	Total        float64 `json:"total"`         // = total_balance（spec §8.2 命名）
	Assets       float64 `json:"assets"`        // 资金组小计（负值原样，透支是事实）
	Investments  float64 `json:"investments"`   // 理财组小计
	Debts        float64 `json:"debts"`         // 信用组小计（⚠️ 保留负数原值，前端取绝对值 + 「负债」标签）
	NetWorth     float64 `json:"net_worth"`     // = assets + investments + debts ≡ total（恒等）
	AccountCount int     `json:"account_count"` // 账户数
}

// ====== 交易 ======

// CreateTransactionReq 创建交易
type CreateTransactionReq struct {
	Type          string  `json:"type"           dc:"类型：expense/income（transfer 走独立接口）"`
	Amount        float64 `json:"amount"         dc:"金额（正数，单位元）"`
	CategoryID    string  `json:"category_id"    dc:"分类 id（可选，须为《分类树》里的 id，传入后服务端按 id 落库）"`
	CategoryEmoji string  `json:"category_emoji" dc:"分类 emoji（向后兼容，可选）"`
	CategoryName  string  `json:"category_name"  dc:"分类名（向后兼容，可选）"`
	AccountID     string  `json:"account_id"     dc:"出/入账账户 ID"`
	HappenedAt    string  `json:"happened_at"    dc:"发生时间 ISO8601（默认 now）"`
	Note          string  `json:"note"           dc:"备注"`

	// 计入口径开关（非指针：缺省 false 即产品默认「计入」）
	ExcludeBudget bool `json:"exclude_budget" dc:"是否不计入预算（默认 false=计入）"`
	ExcludeStats  bool `json:"exclude_stats"  dc:"是否不计入收支统计（默认 false=计入）"`
	// 来源与关联（待报销/借入借出/退款）
	Source   string `json:"source"   dc:"来源：空=普通；reimburse/lend/borrow/refund（⛔ 禁止 balance_adjust）"`
	Contact  string `json:"contact"  dc:"对方（借入借出必填；待报销=报销对象；退款=商家）"`
	SettleOf string `json:"settle_of" dc:"关联的原交易 id（核销/退还笔）"`
}

// UpdateTransactionReq 更新交易（仅 expense / income）
type UpdateTransactionReq struct {
	Amount        *float64 `json:"amount"         dc:"金额（正数）"`
	CategoryID    *string  `json:"category_id"    dc:"分类 id（可选）"`
	CategoryEmoji *string  `json:"category_emoji" dc:"分类 emoji"`
	CategoryName  *string  `json:"category_name"  dc:"分类名"`
	AccountID     *string  `json:"account_id"     dc:"账户 ID"`
	HappenedAt    *string  `json:"happened_at"    dc:"发生时间 ISO8601"`
	Note          *string  `json:"note"           dc:"备注"`

	// 口径开关（指针：缺省=不改）
	ExcludeBudget *bool `json:"exclude_budget" dc:"是否不计入预算（指针，缺省=不改）"`
	ExcludeStats  *bool `json:"exclude_stats"  dc:"是否不计入收支统计（指针，缺省=不改）"`
	// ⚠️ 只允许放开 contact：source / settle_of 禁止修改（改了关联结构就崩）
	Contact *string `json:"contact" dc:"对方（仅放开 contact；source/settle_of 禁止修改）"`
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
	ID            string  `json:"id"`
	Type          string  `json:"type"`
	Amount        float64 `json:"amount"`
	CategoryID    string  `json:"category_id,omitempty"`
	CategoryEmoji string  `json:"category_emoji,omitempty"`
	CategoryName  string  `json:"category_name,omitempty"`
	AccountID     string  `json:"account_id"`
	AccountName   string  `json:"account_name,omitempty"`
	ToAccountID   string  `json:"to_account_id,omitempty"`
	ToAccountName string  `json:"to_account_name,omitempty"`
	Note          string  `json:"note,omitempty"`
	HappenedAt    string  `json:"happened_at"`
	CreatedAt     string  `json:"created_at"`
	// ⚠️ §B4：详情页要显示「更新时间」与「该笔已被撤销」状态，原 TransactionResp 漏列
	UpdatedAt  string `json:"updated_at,omitempty"`
	ReversedBy string `json:"reversed_by,omitempty"`
	// 计入口径 / 来源 / 关联
	ExcludeBudget bool   `json:"exclude_budget"`
	ExcludeStats  bool   `json:"exclude_stats"`
	Source        string `json:"source,omitempty"`
	Contact       string `json:"contact,omitempty"`
	SettleOf      string `json:"settle_of,omitempty"`
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
	Type      string `json:"type"       dc:"按类型筛选（''/expense/income/transfer）"`
	AccountID string `json:"account_id" dc:"按账户筛选"`
	Keyword   string `json:"keyword"    dc:"按备注/分类名模糊搜索"`
	Contact   string `json:"contact"    dc:"按对方筛选（等值，供债权债务卡点行跳转）"`
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
	CategoryID     string  `json:"category_id"     dc:"分类 id（scope=category 时必填，且必须是一级分类）"`
	CategoryEmoji  string  `json:"category_emoji"  dc:"分类 emoji（向后兼容，可选）"`
	CategoryName   string  `json:"category_name"   dc:"分类名称（scope=category 且未传 category_id 时必填）"`
	StartDate      string  `json:"start_date"      dc:"起始日期 YYYY-MM-DD"`
	EndDate        string  `json:"end_date"        dc:"结束日期 YYYY-MM-DD"`
	AlertThreshold float64 `json:"alert_threshold" dc:"预警阈值 0-1，默认0.80"`
}

// UpdateBudgetReq 更新预算
//
// ⚠️ 20260921 补分类字段：此前完全不含分类字段，导致预算建好之后**改不了分类**（02 §3）。
type UpdateBudgetReq struct {
	Name           *string  `json:"name"            dc:"预算名称"`
	Amount         *float64 `json:"amount"          dc:"预算总额"`
	CategoryID     *string  `json:"category_id"     dc:"分类 id（须为一级支出分类）"`
	CategoryName   *string  `json:"category_name"   dc:"分类名称（未传 category_id 时的文本兜底）"`
	CategoryEmoji  *string  `json:"category_emoji"  dc:"分类 emoji"`
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
	CategoryID     string  `json:"category_id,omitempty"`
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

// ====== 收支日历（260921 v2 批次二） ======

// CalendarReq 收支日历查询参数
type CalendarReq struct {
	Month string `json:"month" dc:"月份 YYYY-MM（如 2026-09）"`
}

// CalendarDay 单日收支
type CalendarDay struct {
	Date    string  `json:"date"`    // YYYY-MM-DD
	Income  float64 `json:"income"`  // 当日收入（已排除 exclude_stats=1）
	Expense float64 `json:"expense"` // 当日支出（已排除 exclude_stats=1）
}

// CalendarSummary 当月汇总
type CalendarSummary struct {
	Income  float64 `json:"income"`  // 月收入合计
	Expense float64 `json:"expense"` // 月支出合计
	Net     float64 `json:"net"`     // 净结余（后端算：income - expense）
}

// CalendarResp 收支日历响应
//
// ⚠️ days 只含有记录的日期（不返回 30 天空数组）；summary.net 由后端计算。
type CalendarResp struct {
	Month   string          `json:"month"`
	Days    []CalendarDay   `json:"days"`
	Summary CalendarSummary `json:"summary"`
}

// ====== 债权债务（260921 v4 批次三） ======

// DebtItem 某对方的未结清聚合项
type DebtItem struct {
	Contact string   `json:"contact"` // 对方（空串归并为 —）
	Kinds   []string `json:"kinds"`   // 该对方未结清笔的 source 去重（reimburse/lend/borrow）
	Open    float64  `json:"open"`    // 未结清额（Σ原笔 − Σ核销笔；≤0.005 不返回）
	Count   int      `json:"count"`   // 该对方名下未结清的原笔数
}

// DebtsResp 债权债务响应
//
// ⚠️ 聚合必须在后端（前端 GET /transactions 分页，本地聚合会被截断）。
type DebtsResp struct {
	OwedToMe []DebtItem `json:"owed_to_me"` // 别人欠我（reimburse + lend）
	IOwe     []DebtItem `json:"i_owe"`      // 我欠别人（borrow）
	Net      float64    `json:"net"`        // 净（Σowed_to_me − Σi_owe）
}

// TransactionDao 交易表数据访问对象
package dao

import (
	"context"
	"time"

	"gorm.io/gorm"

	"github.com/life-assistant/api/internal/model"
)

// TransactionDao 交易 DAO 接口
type TransactionDao interface {
	WithContext(ctx context.Context) TransactionDao
	Create(ctx context.Context, t *model.Transaction) error
	GetByID(ctx context.Context, id string) (*model.Transaction, error)
	Update(ctx context.Context, id string, fields map[string]any) error
	Delete(ctx context.Context, id string) error // 软删

	// List 列表查询
	List(ctx context.Context, opts TransactionListOptions) ([]model.Transaction, int64, error)

	// SumByType 统计某用户某段时间的某类型合计
	SumByType(ctx context.Context, userID, txType string, start, end time.Time) (float64, error)

	// ====== 统计模块新增 ======
	// GroupByDay 按日分组统计收入/支出
	GroupByDay(ctx context.Context, userID string, start, end time.Time) ([]TransactionDayRow, error)
	// GroupByCategory 按分类分组统计
	GroupByCategory(ctx context.Context, userID, txType string, start, end time.Time) ([]TransactionCategoryRow, error)
	// GroupByAccount 按账户分组统计
	GroupByAccount(ctx context.Context, userID, txType string, start, end time.Time) ([]TransactionAccountRow, error)
	// ListByRange 取某段时间内所有交易（导出用）
	ListByRange(ctx context.Context, userID string, start, end time.Time) ([]model.Transaction, error)
}

// TransactionListOptions 交易列表查询参数
type TransactionListOptions struct {
	UserID    string
	Type      string // expense / income / transfer
	AccountID string
	Keyword   string // note / category_name 模糊搜索
	StartDate *time.Time
	EndDate   *time.Time
	Page      int
	PageSize  int
}

// TransactionDayRow 按日分组统计行
type TransactionDayRow struct {
	Date    string  `json:"date"`
	Expense float64 `json:"expense"`
	Income  float64 `json:"income"`
}

// TransactionCategoryRow 按分类分组统计行
type TransactionCategoryRow struct {
	CategoryName  string  `json:"category_name"`
	CategoryEmoji string  `json:"category_emoji"`
	Amount        float64 `json:"amount"`
	Count         int64   `json:"count"`
}

// TransactionAccountRow 按账户分组统计行
type TransactionAccountRow struct {
	AccountID   string  `json:"account_id"`
	AccountName string  `json:"account_name"`
	AccountIcon string  `json:"account_icon"`
	Amount      float64 `json:"amount"`
	Count       int64   `json:"count"`
}

type transactionDao struct {
	db *gorm.DB
}

// NewTransactionDao 构造函数
func NewTransactionDao() TransactionDao { return &transactionDao{db: DB} }

func (d *transactionDao) WithContext(ctx context.Context) TransactionDao {
	return &transactionDao{db: d.db.WithContext(ctx)}
}

func (d *transactionDao) Create(ctx context.Context, t *model.Transaction) error {
	return d.db.WithContext(ctx).Create(t).Error
}

func (d *transactionDao) GetByID(ctx context.Context, id string) (*model.Transaction, error) {
	var t model.Transaction
	if err := d.db.WithContext(ctx).Where("id = ?", id).First(&t).Error; err != nil {
		return nil, err
	}
	return &t, nil
}

func (d *transactionDao) Update(ctx context.Context, id string, fields map[string]any) error {
	res := d.db.WithContext(ctx).Model(&model.Transaction{}).Where("id = ?", id).Updates(fields)
	if res.Error != nil {
		return res.Error
	}
	return nil
}

func (d *transactionDao) Delete(ctx context.Context, id string) error {
	return d.db.WithContext(ctx).Where("id = ?", id).Delete(&model.Transaction{}).Error
}

// List 交易列表：分页 + 类型/账户/日期范围筛选
func (d *transactionDao) List(ctx context.Context, opts TransactionListOptions) ([]model.Transaction, int64, error) {
	if opts.Page <= 0 {
		opts.Page = 1
	}
	if opts.PageSize <= 0 || opts.PageSize > 100 {
		opts.PageSize = 20
	}

	q := d.db.WithContext(ctx).Model(&model.Transaction{}).Where("user_id = ?", opts.UserID)
	if opts.Type != "" {
		q = q.Where("type = ?", opts.Type)
	}
	if opts.AccountID != "" {
		// 出账账户 OR 转入账户
		q = q.Where("account_id = ? OR to_account_id = ?", opts.AccountID, opts.AccountID)
	}
	if opts.Keyword != "" {
		like := "%" + opts.Keyword + "%"
		q = q.Where("note LIKE ? OR category_name LIKE ?", like, like)
	}
	if opts.StartDate != nil {
		q = q.Where("happened_at >= ?", *opts.StartDate)
	}
	if opts.EndDate != nil {
		q = q.Where("happened_at < ?", *opts.EndDate)
	}

	var total int64
	if err := q.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	var items []model.Transaction
	if err := q.Order("happened_at DESC, created_at DESC").
		Limit(opts.PageSize).
		Offset((opts.Page - 1) * opts.PageSize).
		Find(&items).Error; err != nil {
		return nil, 0, err
	}
	return items, total, nil
}

// SumByType 统计某用户某段时间的某类型合计
func (d *transactionDao) SumByType(ctx context.Context, userID, txType string, start, end time.Time) (float64, error) {
	var total float64
	q := d.db.WithContext(ctx).
		Model(&model.Transaction{}).
		Where("user_id = ? AND type = ?", userID, txType)
	if !start.IsZero() {
		q = q.Where("happened_at >= ?", start)
	}
	if !end.IsZero() {
		q = q.Where("happened_at < ?", end)
	}
	err := q.Select("COALESCE(SUM(amount), 0)").Scan(&total).Error
	if err != nil {
		return 0, err
	}
	return total, nil
}

// GroupByDay 按日分组统计收入/支出
//
// ⚠️ 260920 修复：原来写 `DATE(happened_at) as date`，MySQL 返回的是 DATE 类型，
// 而 TransactionDayRow.Date 是 string —— 驱动（parseTime=true）把它转成
// time.Time 后，GORM 落成 `time.Time` 的字符串形式，实测返回
// "2026-09-15T00:00:00+08:00"，与 dto.FinanceDayStat.Date 声明的
// "YYYY-MM-DD" 不符，前端 `date.slice(5)` 直接得到 "09-15T00:00:00+08:00"，
// 图表 X 轴标签全变成完整时间戳（之前无数据所以没暴露）。
// 用 DATE_FORMAT 让 MySQL 直接产出字符串，契约回到 YYYY-MM-DD。
// （happened_at 为 NOT NULL，无需 COALESCE。）
func (d *transactionDao) GroupByDay(ctx context.Context, userID string, start, end time.Time) ([]TransactionDayRow, error) {
	var rows []TransactionDayRow
	err := d.db.WithContext(ctx).
		Model(&model.Transaction{}).
		Select("DATE_FORMAT(happened_at, '%Y-%m-%d') as date, "+
			"COALESCE(SUM(CASE WHEN type = ? THEN amount ELSE 0 END), 0) as expense, "+
			"COALESCE(SUM(CASE WHEN type = ? THEN amount ELSE 0 END), 0) as income",
			model.TransactionTypeExpense, model.TransactionTypeIncome).
		Where("user_id = ? AND happened_at >= ? AND happened_at < ?", userID, start, end).
		Where("type IN ?", []string{model.TransactionTypeExpense, model.TransactionTypeIncome}).
		// ⚠️ GROUP BY 必须与 SELECT 里的表达式**逐字一致**：
		// 写成 GROUP BY DATE(happened_at) 会踩 sql_mode=only_full_group_by
		// （Error 1055：DATE_FORMAT 与 DATE 不构成函数依赖）。
		Group("DATE_FORMAT(happened_at, '%Y-%m-%d')").
		Order("date ASC").
		Find(&rows).Error
	return rows, err
}

// GroupByCategory 按分类分组统计
func (d *transactionDao) GroupByCategory(ctx context.Context, userID, txType string, start, end time.Time) ([]TransactionCategoryRow, error) {
	var rows []TransactionCategoryRow
	q := d.db.WithContext(ctx).
		Model(&model.Transaction{}).
		Select("COALESCE(category_name, '未分类') as category_name, "+
			"COALESCE(category_emoji, '📂') as category_emoji, "+
			"SUM(amount) as amount, COUNT(*) as count").
		Where("user_id = ? AND happened_at >= ? AND happened_at < ?", userID, start, end)
	if txType != "" {
		q = q.Where("type = ?", txType)
	}
	err := q.Group("category_name, category_emoji").
		Order("amount DESC").
		Find(&rows).Error
	return rows, err
}

// GroupByAccount 按账户分组统计
func (d *transactionDao) GroupByAccount(ctx context.Context, userID, txType string, start, end time.Time) ([]TransactionAccountRow, error) {
	var rows []TransactionAccountRow
	q := d.db.WithContext(ctx).
		Table("transactions t").
		Select("t.account_id as account_id, a.name as account_name, a.icon as account_icon, "+
			"SUM(t.amount) as amount, COUNT(*) as count").
		Joins("LEFT JOIN accounts a ON t.account_id = a.id").
		Where("t.user_id = ? AND t.happened_at >= ? AND t.happened_at < ?", userID, start, end)
	if txType != "" {
		q = q.Where("t.type = ?", txType)
	}
	err := q.Group("t.account_id, a.name, a.icon").
		Order("amount DESC").
		Find(&rows).Error
	return rows, err
}

// ListByRange 取某段时间内所有交易（导出用）
func (d *transactionDao) ListByRange(ctx context.Context, userID string, start, end time.Time) ([]model.Transaction, error) {
	var items []model.Transaction
	err := d.db.WithContext(ctx).
		Where("user_id = ? AND happened_at >= ? AND happened_at < ?", userID, start, end).
		Order("happened_at ASC").
		Find(&items).Error
	return items, err
}
